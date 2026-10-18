package com.suchmusic.app.plugins;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "MediaSession",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class MediaSessionPlugin extends Plugin {

    static MediaSessionPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    void notifyControl(String action) {
        notifyControl(action, 0);
    }

    void notifyControl(String action, long positionMs) {
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("positionMs", positionMs);
        notifyListeners("control", data);
    }

    @PluginMethod
    public void start(PluginCall call) {
        // Android 13+ 需要通知权限
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "onNotificationPermission");
            return;
        }
        startService();
        call.resolve();
    }

    @PermissionCallback
    private void onNotificationPermission(PluginCall call) {
        startService();
        call.resolve();
    }

    private void startService() {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(MediaPlaybackService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), intent);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(MediaPlaybackService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(MediaPlaybackService.ACTION_UPDATE_META);
        intent.putExtra("title", call.getString("title", ""));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("album", call.getString("album", ""));
        intent.putExtra("coverUrl", call.getString("coverUrl", ""));
        intent.putExtra("durationMs", call.getDouble("durationMs", 0.0).longValue());
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void updatePlayback(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(MediaPlaybackService.ACTION_UPDATE_STATE);
        intent.putExtra("playing", call.getBoolean("playing", false));
        Double pos = call.getDouble("positionMs", 0.0);
        Double dur = call.getDouble("durationMs", 0.0);
        intent.putExtra("positionMs", pos.longValue());
        intent.putExtra("durationMs", dur.longValue());
        getContext().startService(intent);
        call.resolve();
    }
}
