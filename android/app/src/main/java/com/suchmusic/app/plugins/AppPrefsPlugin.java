package com.suchmusic.app.plugins;

import android.content.pm.ActivityInfo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 应用偏好原生插件：
 * - setOrientation：设置界面旋转方向（跟随系统 / 竖屏 / 横屏）
 */
@CapacitorPlugin(name = "AppPrefs")
public class AppPrefsPlugin extends Plugin {

    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "auto");
        final int orientation;
        switch (mode != null ? mode : "auto") {
            case "portrait":
                orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
                break;
            case "landscape":
                orientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
                break;
            case "auto":
            default:
                orientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
                break;
        }
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(orientation);
            call.resolve();
        });
    }
}
