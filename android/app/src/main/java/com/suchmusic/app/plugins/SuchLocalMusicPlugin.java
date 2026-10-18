package com.suchmusic.app.plugins;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(
    name = "SuchLocalMusic",
    permissions = {
        @Permission(
            alias = "storage",
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE }
        )
    }
)
public class SuchLocalMusicPlugin extends Plugin {

    private static final Set<String> AUDIO_EXTS =
        new HashSet<>(Arrays.asList(".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg"));

    /** 原生提取音频元数据（避免 WebView 读取整文件导致 OOM） */
    @PluginMethod
    public void getMeta(PluginCall call) {
        String path = call.getString("path");
        JSObject ret = new JSObject();
        android.media.MediaMetadataRetriever mmr = new android.media.MediaMetadataRetriever();
        try {
            mmr.setDataSource(path);
            String title = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String album = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String duration = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION);
            String bitrate = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_BITRATE);
            if (title != null && !title.isEmpty()) ret.put("title", title);
            if (artist != null && !artist.isEmpty() && !"<unknown>".equals(artist)) ret.put("artist", artist);
            if (album != null && !album.isEmpty()) ret.put("album", album);
            if (duration != null) ret.put("durationMs", Long.parseLong(duration));
            if (bitrate != null) ret.put("bitrate", Long.parseLong(bitrate));

            byte[] pic = mmr.getEmbeddedPicture();
            if (pic != null && pic.length > 0) {
                android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(pic, 0, pic.length);
                if (bmp != null) {
                    int max = 300;
                    float scale = Math.min(1f, (float) max / Math.max(bmp.getWidth(), bmp.getHeight()));
                    android.graphics.Bitmap scaled = scale < 1f
                        ? android.graphics.Bitmap.createScaledBitmap(bmp,
                            Math.max(1, Math.round(bmp.getWidth() * scale)),
                            Math.max(1, Math.round(bmp.getHeight() * scale)), true)
                        : bmp;
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, out);
                    ret.put("coverBase64", android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP));
                    ret.put("coverMime", "image/jpeg");
                }
            }
        } catch (Exception ignored) {
            // 解析失败返回空对象
        } finally {
            try {
                mmr.release();
            } catch (Exception ignored) {}
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void getMusicDir(PluginCall call) {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
        JSObject ret = new JSObject();
        ret.put("path", dir.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void fsExists(PluginCall call) {
        String path = call.getString("path");
        JSObject ret = new JSObject();
        ret.put("exists", path != null && new File(path).exists());
        call.resolve(ret);
    }

    @PluginMethod
    public void checkStoragePermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasStorageAccess());
        call.resolve(ret);
    }

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= 30) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void requestStoragePermission(PluginCall call) {
        if (hasStorageAccess()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            // 所有文件访问权限需要跳转到系统设置
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            } catch (Exception e) {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            }
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
        } else {
            requestPermissionForAlias("storage", call, "onLegacyPermissionResult");
        }
    }

    @PermissionCallback
    private void onLegacyPermissionResult(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasStorageAccess());
        call.resolve(ret);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        JSArray dirsArg = call.getArray("dirs");
        List<File> roots = new ArrayList<>();
        try {
            if (dirsArg != null && dirsArg.length() > 0) {
                List<String> list = dirsArg.toList();
                for (String d : list) roots.add(new File(d));
            }
        } catch (Exception ignored) {}

        JSObject ret = new JSObject();
        JSArray tracks = new JSArray();

        if (roots.isEmpty()) {
            // 默认：通过 MediaStore 查询全设备音频（不受单一目录限制）
            tracks = scanViaMediaStore();
            File musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
            ret.put("rootDir", musicDir.getAbsolutePath());
            JSArray defaultRoots = new JSArray();
            defaultRoots.put(musicDir.getAbsolutePath());
            ret.put("rootDirs", defaultRoots);
            // MediaStore 无结果时回退到目录遍历
            if (tracks.length() == 0) {
                Set<String> seen = new HashSet<>();
                walk(musicDir, tracks, seen);
            }
        } else {
            Set<String> seen = new HashSet<>();
            for (File root : roots) {
                walk(root, tracks, seen);
            }
            ret.put("rootDir", roots.get(0).getAbsolutePath());
            JSArray rootDirs = new JSArray();
            for (File r : roots) rootDirs.put(r.getAbsolutePath());
            ret.put("rootDirs", rootDirs);
        }

        ret.put("tracks", tracks);
        call.resolve(ret);
    }

    /** 通过 MediaStore 查询全设备音乐文件 */
    private JSArray scanViaMediaStore() {
        JSArray tracks = new JSArray();
        try {
            android.net.Uri uri = android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
            String[] projection = {
                android.provider.MediaStore.Audio.Media.DATA,
                android.provider.MediaStore.Audio.Media.TITLE,
                android.provider.MediaStore.Audio.Media.ARTIST,
                android.provider.MediaStore.Audio.Media.ALBUM,
                android.provider.MediaStore.Audio.Media.DURATION
            };
            String selection = android.provider.MediaStore.Audio.Media.IS_MUSIC + " != 0";
            try (android.database.Cursor cursor = getContext().getContentResolver()
                .query(uri, projection, selection, null, null)) {
                if (cursor != null) {
                    Set<String> seen = new HashSet<>();
                    while (cursor.moveToNext()) {
                        String path = cursor.getString(0);
                        if (path == null || path.isEmpty() || seen.contains(path)) continue;
                        String ext = extOf(path);
                        if (!AUDIO_EXTS.contains(ext)) continue;
                        if (!new File(path).exists()) continue;
                        seen.add(path);

                        String title = cursor.getString(1);
                        String artist = cursor.getString(2);
                        String album = cursor.getString(3);
                        long duration = cursor.getLong(4);

                        // 与桌面端一致：尝试从文件名解析 "艺术家 - 标题"
                        if (title == null || title.isEmpty() || "<unknown>".equals(artist)) {
                            String rawName = new File(path).getName();
                            rawName = rawName.substring(0, rawName.length() - ext.length());
                            String[] parts = rawName.split("-");
                            if (parts.length == 2) {
                                if (artist == null || artist.isEmpty() || "<unknown>".equals(artist)) {
                                    artist = parts[0].trim();
                                }
                                if (title == null || title.isEmpty()) {
                                    title = parts[1].trim();
                                }
                            }
                            if (title == null || title.isEmpty()) title = rawName;
                        }
                        if (artist == null || artist.isEmpty() || "<unknown>".equals(artist)) {
                            artist = "本地音乐";
                        }
                        if (album == null || album.isEmpty()) {
                            File parent = new File(path).getParentFile();
                            album = parent != null && parent.getName() != null
                                && !parent.getName().isEmpty() ? parent.getName() : "本地音乐";
                        }

                        JSObject track = new JSObject();
                        track.put("id", path);
                        track.put("name", title);
                        track.put("filePath", path);
                        track.put("artist", artist);
                        track.put("album", album);
                        if (duration > 0) track.put("durationMs", duration);
                        tracks.put(track);
                    }
                }
            }
        } catch (Exception e) {
            // MediaStore 查询失败时返回空，由调用方回退
        }
        return tracks;
    }

    private void walk(File dir, JSArray tracks, Set<String> seen) {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isDirectory()) {
                walk(f, tracks, seen);
                continue;
            }
            String name = f.getName();
            String ext = extOf(name);
            if (!AUDIO_EXTS.contains(ext)) continue;
            String fullPath = f.getAbsolutePath();
            if (seen.contains(fullPath)) continue;
            seen.add(fullPath);

            String rawName = name.substring(0, name.length() - ext.length());
            String title = rawName;
            String artist = "本地音乐";
            String[] parts = rawName.split("-");
            if (parts.length == 2) {
                String a = parts[0].trim();
                String t = parts[1].trim();
                if (!a.isEmpty()) artist = a;
                if (!t.isEmpty()) title = t;
            }
            String album = "本地音乐";
            File parent = f.getParentFile();
            if (parent != null && parent.getName() != null && !parent.getName().isEmpty()) {
                album = parent.getName();
            }

            JSObject track = new JSObject();
            track.put("id", fullPath);
            track.put("name", title);
            track.put("filePath", fullPath);
            track.put("artist", artist);
            track.put("album", album);
            tracks.put(track);
        }
    }

    private static String extOf(String name) {
        int idx = name.lastIndexOf('.');
        return idx >= 0 ? name.substring(idx).toLowerCase() : "";
    }

    @PluginMethod
    public void chooseDirs(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onDirChosen");
    }

    @ActivityCallback
    private void onDirChosen(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            ret.put("canceled", true);
            ret.put("dirs", new JSArray());
            call.resolve(ret);
            return;
        }
        Uri treeUri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}

        String path = treeUriToPath(treeUri);
        JSArray dirs = new JSArray();
        if (path != null) dirs.put(path);
        ret.put("canceled", path == null);
        ret.put("dirs", dirs);
        call.resolve(ret);
    }

    /** 将 SAF tree URI 转换为主存储真实路径（仅支持内置存储） */
    private String treeUriToPath(Uri uri) {
        try {
            String docId = android.provider.DocumentsContract.getTreeDocumentId(uri);
            // 形如 "primary:Music/xxx"
            if (docId != null && docId.startsWith("primary:")) {
                String rel = docId.substring("primary:".length());
                return Environment.getExternalStorageDirectory().getAbsolutePath()
                    + (rel.isEmpty() ? "" : "/" + rel);
            }
        } catch (Exception ignored) {}
        return null;
    }

    /** 通过 SAF 选择文本文件（用于导入 JS 插件） */
    @PluginMethod
    public void pickTextFiles(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "onTextFilesPicked");
    }

    @ActivityCallback
    private void onTextFilesPicked(PluginCall call, ActivityResult result) {
        JSObject ret = new JSObject();
        JSArray files = new JSArray();
        boolean canceled = result.getResultCode() != android.app.Activity.RESULT_OK
            || result.getData() == null;

        if (!canceled) {
            List<Uri> uris = new ArrayList<>();
            Intent data = result.getData();
            if (data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    uris.add(data.getClipData().getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }

            for (Uri uri : uris) {
                try {
                    String content = readUriText(uri);
                    if (content != null) {
                        JSObject f = new JSObject();
                        f.put("name", queryDisplayName(uri));
                        f.put("content", content);
                        files.put(f);
                    }
                } catch (Exception e) {
                    getContext(); // 读取失败的文件跳过
                }
            }
        }

        ret.put("canceled", canceled);
        ret.put("files", files);
        call.resolve(ret);
    }

    private String readUriText(Uri uri) throws Exception {
        java.io.InputStream in = getContext().getContentResolver().openInputStream(uri);
        if (in == null) return null;
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private String queryDisplayName(Uri uri) {
        try (android.database.Cursor cursor = getContext().getContentResolver()
            .query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) return cursor.getString(idx);
            }
        } catch (Exception ignored) {}
        return "plugin.js";
    }

    @PluginMethod
    public void deleteFiles(PluginCall call) {
        JSArray paths = call.getArray("paths");
        int deleted = 0;
        int failed = 0;
        if (paths != null) {
            try {
                List<String> list = paths.toList();
                for (String p : list) {
                    try {
                        File f = new File(p);
                        if (!f.exists() || f.delete()) {
                            deleted++;
                        } else {
                            failed++;
                        }
                    } catch (Exception e) {
                        failed++;
                    }
                }
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("deletedCount", deleted);
        ret.put("failedCount", failed);
        call.resolve(ret);
    }
}
