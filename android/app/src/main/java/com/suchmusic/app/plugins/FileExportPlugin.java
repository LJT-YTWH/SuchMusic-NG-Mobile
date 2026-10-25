package com.suchmusic.app.plugins;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 文件导出原生插件：
 * - saveFiles：弹出系统目录选择器（SAF），把文本/本地音频写入用户选择的文件夹。
 *
 * 通过 SAF 写入，无需「所有文件访问权限」，支持内置存储、SD 卡与第三方文件管理器提供的目录。
 */
@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {

    @PluginMethod
    public void saveFiles(PluginCall call) {
        JSArray files = call.getArray("files");
        if (files == null || files.length() == 0) {
            call.reject("没有可导出的文件");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onTreePicked");
    }

    @ActivityCallback
    private void onTreePicked(PluginCall call, ActivityResult result) {
        if (call == null) return;

        JSObject ret = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null
                || result.getData().getData() == null) {
            ret.put("canceled", true);
            ret.put("count", 0);
            ret.put("failed", 0);
            call.resolve(ret);
            return;
        }

        Uri treeUri = result.getData().getData();
        ContentResolver resolver = getContext().getContentResolver();
        try {
            resolver.takePersistableUriPermission(treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (Exception ignored) {
        }

        final String treeDocId;
        try {
            treeDocId = DocumentsContract.getTreeDocumentId(treeUri);
        } catch (Exception e) {
            call.reject("无法访问所选目录");
            return;
        }
        final Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, treeDocId);
        final JSArray files = call.getArray("files");
        if (files == null) {
            call.reject("没有可导出的文件");
            return;
        }

        new Thread(() -> {
            int count = 0;
            int failed = 0;
            String firstError = null;

            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.optJSONObject(i);
                if (f == null) continue;

                String name = f.optString("name", "");
                String mime = f.optString("mimeType", "application/octet-stream");
                if (name.isEmpty()) {
                    failed++;
                    continue;
                }

                try {
                    Uri docUri = DocumentsContract.createDocument(resolver, parentUri, mime, name);
                    if (docUri == null) throw new Exception("无法创建文件");

                    // 部分系统文件管理器会按 MIME 追加扩展名（如 .lrc → .lrc.txt），
                    // 这里查询实际文件名，不一致时用 renameDocument 纠正为原始文件名。
                    docUri = ensureDisplayName(resolver, docUri, name);

                    InputStream in = openSource(resolver, f);
                    if (in == null) throw new Exception("无法读取源文件");
                    try (InputStream input = in;
                         OutputStream out = resolver.openOutputStream(docUri, "wt")) {
                        if (out == null) throw new Exception("无法写入文件");
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = input.read(buf)) > 0) {
                            out.write(buf, 0, n);
                        }
                        out.flush();
                    }
                    count++;
                } catch (Exception e) {
                    failed++;
                    if (firstError == null) {
                        firstError = e.getMessage() != null ? e.getMessage() : e.toString();
                    }
                }
            }

            final int okCount = count;
            final int failCount = failed;
            final String error = firstError;
            JSObject out = new JSObject();
            out.put("canceled", false);
            out.put("count", okCount);
            out.put("failed", failCount);
            out.put("location", displayLocation(treeDocId));
            if (error != null) out.put("error", error);

            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> call.resolve(out));
            } else {
                call.resolve(out);
            }
        }).start();
    }

    /** 确保文档显示名与预期一致（修正部分文件管理器自动追加 .txt 等后缀） */
    private Uri ensureDisplayName(ContentResolver resolver, Uri docUri, String desiredName) {
        String actual = queryDisplayName(resolver, docUri);
        if (desiredName.equals(actual)) return docUri;
        try {
            Uri renamed = DocumentsContract.renameDocument(resolver, docUri, desiredName);
            return renamed != null ? renamed : docUri;
        } catch (Exception ignored) {
            return docUri;
        }
    }

    private String queryDisplayName(ContentResolver resolver, Uri docUri) {
        try (Cursor cursor = resolver.query(
                docUri,
                new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getString(0);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /** 读取待写入内容：文本优先，其次按路径/URI 打开源文件 */
    private InputStream openSource(ContentResolver resolver, JSONObject f) throws Exception {
        String text = f.optString("text", null);
        if (text != null) {
            return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
        }
        String src = f.optString("sourcePath", null);
        if (src == null || src.isEmpty()) return null;
        if (src.startsWith("content://")) {
            return resolver.openInputStream(Uri.parse(src));
        }
        if (src.startsWith("file://")) {
            return new FileInputStream(new File(Uri.parse(src).getPath()));
        }
        return new FileInputStream(new File(src));
    }

    /** 把 SAF 文档 ID 转成便于展示的路径 */
    private String displayLocation(String treeDocId) {
        if (treeDocId == null) return "";
        if (treeDocId.startsWith("primary:")) {
            String rel = treeDocId.substring("primary:".length());
            return rel.isEmpty() ? "内部存储" : rel;
        }
        return treeDocId;
    }
}
