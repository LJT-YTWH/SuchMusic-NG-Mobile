package com.suchmusic.app.plugins;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * 前台媒体播放服务：
 * - 保持进程存活，使 WebView 中的 Web Audio 在后台继续播放
 * - 提供锁屏/通知栏媒体控制（MediaSession + MediaStyle 通知）
 */
public class MediaPlaybackService extends Service {

    public static final String ACTION_START = "com.suchmusic.app.media.START";
    public static final String ACTION_STOP = "com.suchmusic.app.media.STOP";
    public static final String ACTION_UPDATE_META = "com.suchmusic.app.media.UPDATE_META";
    public static final String ACTION_UPDATE_STATE = "com.suchmusic.app.media.UPDATE_STATE";
    public static final String ACTION_PLAY_PAUSE = "com.suchmusic.app.media.PLAY_PAUSE";
    public static final String ACTION_PREV = "com.suchmusic.app.media.PREV";
    public static final String ACTION_NEXT = "com.suchmusic.app.media.NEXT";

    private static final String CHANNEL_ID = "suchmusic_playback";
    private static final int NOTIFICATION_ID = 1001;

    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;

    private String title = "SuchMusic";
    private String artist = "";
    private String album = "";
    private String coverUrl = "";
    private long durationMs = 0;
    private boolean playing = false;
    private long positionMs = 0;
    private Bitmap coverBitmap;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        mediaSession = new MediaSession(this, "SuchMusicSession");
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
            | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() { sendControl("play"); }
            @Override
            public void onPause() { sendControl("pause"); }
            @Override
            public void onSkipToNext() { sendControl("next"); }
            @Override
            public void onSkipToPrevious() { sendControl("prev"); }
            @Override
            public void onStop() { sendControl("pause"); }
            @Override
            public void onSeekTo(long pos) { sendControlSeek(pos); }
        });
        mediaSession.setActive(true);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "suchmusic:playback");
        wakeLock.setReferenceCounted(false);
    }

    private void sendControl(String action) {
        if (MediaSessionPlugin.instance != null) {
            MediaSessionPlugin.instance.notifyControl(action);
        }
    }

    private void sendControlSeek(long positionMs) {
        if (MediaSessionPlugin.instance != null) {
            MediaSessionPlugin.instance.notifyControl("seekto", positionMs);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            startForegroundWithNotification();
            return START_STICKY;
        }
        switch (intent.getAction()) {
            case ACTION_START:
                startForegroundWithNotification();
                requestAudioFocus();
                if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
                break;
            case ACTION_STOP:
                stopSelf();
                break;
            case ACTION_UPDATE_META:
                title = intent.getStringExtra("title");
                artist = intent.getStringExtra("artist");
                album = intent.getStringExtra("album");
                String newCover = intent.getStringExtra("coverUrl");
                durationMs = intent.getLongExtra("durationMs", 0);
                startForegroundWithNotification();
                if (newCover != null && !newCover.equals(coverUrl)) {
                    coverUrl = newCover;
                    loadCoverAsync(coverUrl);
                } else {
                    pushMetadata(coverBitmap);
                }
                break;
            case ACTION_UPDATE_STATE:
                playing = intent.getBooleanExtra("playing", false);
                positionMs = intent.getLongExtra("positionMs", 0);
                long dur = intent.getLongExtra("durationMs", 0);
                if (dur > 0) durationMs = dur;
                startForegroundWithNotification();
                pushPlaybackState();
                updateNotification();
                break;
            case ACTION_PLAY_PAUSE:
                sendControl("toggle");
                break;
            case ACTION_PREV:
                sendControl("prev");
                break;
            case ACTION_NEXT:
                sendControl("next");
                break;
        }
        return START_STICKY;
    }

    private void requestAudioFocus() {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            //noinspection deprecation
            am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void loadCoverAsync(final String url) {
        new Thread(() -> {
            Bitmap bmp = decodeCover(url);
            coverBitmap = bmp;
            pushMetadata(bmp);
            // 封面到位后重新推送通知，避免状态栏媒体胶囊沿用应用图标
            startForegroundWithNotification();
        }).start();
    }

    /**
     * 解码封面。支持：
     * - data:image/xxx;base64,...（本地歌曲内嵌封面，Web 端就是这种形式）
     * - file:///...、/storage/...（本地文件）
     * - content://...
     * - Capacitor 的 http(s)://localhost/_capacitor_file_/... / _capacitor_content_/...
     * - 普通 http(s) 封面（带常见防盗链 Referer）
     */
    private Bitmap decodeCover(String url) {
        if (url == null || url.isEmpty()) return null;
        try {
            if (url.startsWith("data:")) {
                int comma = url.indexOf(',');
                if (comma < 0) return null;
                String meta = url.substring(5, comma);
                String payload = url.substring(comma + 1);
                byte[] bytes = meta.contains(";base64")
                    ? Base64.decode(payload, Base64.DEFAULT)
                    : payload.getBytes(StandardCharsets.UTF_8);
                return decodeBytes(bytes);
            }
            if (url.startsWith("content://")) {
                return decodeStream(getContentResolver().openInputStream(Uri.parse(url)));
            }
            int contentIdx = url.indexOf("_capacitor_content_");
            if (contentIdx >= 0) {
                String raw = url.substring(contentIdx + "_capacitor_content_".length());
                return decodeStream(getContentResolver().openInputStream(Uri.parse("content://" + raw)));
            }
            String path = null;
            if (url.startsWith("file://")) {
                path = Uri.parse(url).getPath();
            } else if (url.startsWith("/")) {
                path = url;
            } else {
                int fileIdx = url.indexOf("_capacitor_file_");
                if (fileIdx >= 0) {
                    path = url.substring(fileIdx + "_capacitor_file_".length());
                }
            }
            if (path != null) return decodeFile(path);
            return decodeRemote(url);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private Bitmap decodeBytes(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return null;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        opts.inSampleSize = calcInSampleSize(opts, 1024);
        opts.inJustDecodeBounds = false;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    }

    private Bitmap decodeStream(InputStream in) {
        if (in == null) return null;
        try {
            return BitmapFactory.decodeStream(in);
        } catch (Throwable ignored) {
            return null;
        } finally {
            try { in.close(); } catch (Throwable ignored) {}
        }
    }

    private Bitmap decodeFile(String path) {
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, opts);
        opts.inSampleSize = calcInSampleSize(opts, 1024);
        opts.inJustDecodeBounds = false;
        return BitmapFactory.decodeFile(path, opts);
    }

    private Bitmap decodeRemote(String url) {
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            // 注入常见防盗链 Referer
            if (url.contains("126.net") || url.contains("163.com")) {
                conn.setRequestProperty("Referer", "https://music.163.com/");
            } else if (url.contains("qpic.cn") || url.contains("gtimg.cn")) {
                conn.setRequestProperty("Referer", "https://y.qq.com/");
            } else if (url.contains("kugou.com")) {
                conn.setRequestProperty("Referer", "https://www.kugou.com/");
            } else if (url.contains("kuwo.cn")) {
                conn.setRequestProperty("Referer", "https://www.kuwo.cn/");
            } else if (url.contains("hdslb.com") || url.contains("bilibili.com")) {
                conn.setRequestProperty("Referer", "https://www.bilibili.com/");
            } else if (url.contains("migu.cn")) {
                conn.setRequestProperty("Referer", "https://music.migu.cn/");
            }
            return decodeStream(conn.getInputStream());
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static int calcInSampleSize(BitmapFactory.Options opts, int target) {
        int size = Math.max(opts.outWidth, opts.outHeight);
        int sample = 1;
        while (size / sample > target * 2) sample *= 2;
        return Math.max(1, sample);
    }

    private void pushMetadata(Bitmap cover) {
        if (mediaSession == null) return;
        MediaMetadata.Builder builder = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (cover != null) {
            // 各 ROM「灵动岛 / 焦点通知 / 流体云」取图键位不同，全部写入
            builder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cover)
                .putBitmap(MediaMetadata.METADATA_KEY_ART, cover)
                .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, cover);
        }
        mediaSession.setMetadata(builder.build());
    }

    private void pushPlaybackState() {
        if (mediaSession == null) return;
        PlaybackState state = new PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                positionMs, 1.0f)
            .build();
        mediaSession.setPlaybackState(state);
    }

    private PendingIntent actionIntent(String action, int reqCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class);
        intent.setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, reqCode, intent, flags);
    }

    private void startForegroundWithNotification() {
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
    }

    private Notification buildNotification() {
        // 点击通知打开主界面
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = launch != null
            ? PendingIntent.getActivity(this, 0, launch, flags)
            : null;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "上一首", actionIntent(ACTION_PREV, 1))
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "暂停" : "播放", actionIntent(ACTION_PLAY_PAUSE, 2))
            .addAction(android.R.drawable.ic_media_next, "下一首", actionIntent(ACTION_NEXT, 3))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setShowActionsInCompactView(0, 1, 2));

        // 关键：把 MediaSession Token 绑定到通知（android.mediaSession extra）。
        // 各安卓 ROM 的「灵动岛 / 焦点通知 / 灵动胶囊 / 流体云」均通过
        // 「MediaStyle 通知 + MediaSession Token」识别媒体播放场景，
        // 缺少该 extra 时通知不会被提升为状态栏媒体胶囊。
        try {
            builder.getExtras().putParcelable("android.mediaSession", mediaSession.getSessionToken());
        } catch (Throwable ignored) {}

        // Android 16+ Live Updates / 各 ROM「灵动岛·焦点通知」：
        // 请求将进行中通知提升为状态栏胶囊（低版本自动忽略该 extra）
        if (playing) {
            try {
                builder.getExtras().putBoolean("android.requestPromotedOngoing", true);
            } catch (Throwable ignored) {}
        }

        if (coverBitmap != null) builder.setLargeIcon(coverBitmap);
        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            // 部分 ROM（小米焦点通知、荣耀灵动胶囊等）不会提升 LOW 重要级别的渠道，
            // 使用 DEFAULT 并显式关闭提示音/震动，兼顾媒体胶囊展示与静默体验
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "播放控制", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("音乐播放控制通知");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
