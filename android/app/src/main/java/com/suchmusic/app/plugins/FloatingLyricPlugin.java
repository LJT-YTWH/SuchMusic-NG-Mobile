package com.suchmusic.app.plugins;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FloatingLyric")
public class FloatingLyricPlugin extends Plugin {

    static FloatingLyricPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    void notifyControl(String action, String mode) {
        JSObject data = new JSObject();
        data.put("action", action);
        data.put("mode", mode);
        notifyListeners("control", data);
    }

    @PluginMethod
    public void checkOverlayPermission(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(ret);
    }

    private void ensureService() {
        Intent intent = new Intent(getContext(), FloatingLyricService.class);
        getContext().startService(intent);
    }

    @PluginMethod
    public void open(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) {
            // 跳转悬浮窗权限设置页
            Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.reject("未授予悬浮窗权限，请在系统设置中允许后重试");
            return;
        }
        ensureService();
        String mode = call.getString("mode", "full");
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.showOverlay(mode);
        }
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        String mode = call.getString("mode", "full");
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.hideOverlay(mode);
        }
        call.resolve();
    }

    @PluginMethod
    public void isOpen(PluginCall call) {
        String mode = call.getString("mode", "full");
        JSObject ret = new JSObject();
        ret.put("open", FloatingLyricService.instance != null
            && FloatingLyricService.instance.isOverlayShown(mode));
        call.resolve(ret);
    }

    @PluginMethod
    public void updateLyrics(PluginCall call) {
        String mode = call.getString("mode", "full");
        JSArray lines = call.getArray("lines");
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.updateLyrics(mode, lines);
        }
        call.resolve();
    }

    @PluginMethod
    public void updateTime(PluginCall call) {
        String mode = call.getString("mode", "full");
        Double time = call.getDouble("time", 0.0);
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.updateTime(mode, time.floatValue());
        }
        call.resolve();
    }

    @PluginMethod
    public void updatePlaying(PluginCall call) {
        String mode = call.getString("mode", "full");
        boolean playing = call.getBoolean("playing", false);
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.updatePlaying(mode, playing);
        }
        call.resolve();
    }

    @PluginMethod
    public void updateInfo(PluginCall call) {
        String mode = call.getString("mode", "full");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.updateInfo(mode, title, artist);
        }
        call.resolve();
    }

    @PluginMethod
    public void updateSettings(PluginCall call) {
        String mode = call.getString("mode", "full");
        JSObject settings = new JSObject();
        if (call.hasOption("fontSize")) settings.put("fontSize", call.getDouble("fontSize"));
        if (call.hasOption("fontColor")) settings.put("fontColor", call.getString("fontColor"));
        if (call.hasOption("highlightColor")) settings.put("highlightColor", call.getString("highlightColor"));
        if (call.hasOption("opacity")) settings.put("opacity", call.getDouble("opacity"));
        if (call.hasOption("showNextLine")) settings.put("showNextLine", call.getBoolean("showNextLine"));
        if (call.hasOption("align")) settings.put("align", call.getString("align"));
        if (call.hasOption("locked")) settings.put("locked", call.getBoolean("locked"));
        if (FloatingLyricService.instance != null) {
            FloatingLyricService.instance.updateSettings(mode, settings);
        }
        call.resolve();
    }
}
