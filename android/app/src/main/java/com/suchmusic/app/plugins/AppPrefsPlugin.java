package com.suchmusic.app.plugins;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;

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
        int orientation;
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
        // 电视（Android TV / 电视盒子）没有竖屏形态，无论设置为何都保持横屏
        if ((getActivity().getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION) {
            orientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        }
        final int requested = orientation;
        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(requested);
            call.resolve();
        });
    }
}
