package com.suchmusic.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.suchmusic.app.plugins.AppPrefsPlugin;
import com.suchmusic.app.plugins.FloatingLyricPlugin;
import com.suchmusic.app.plugins.MediaSessionPlugin;
import com.suchmusic.app.plugins.SuchLocalMusicPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册自定义原生插件
        registerPlugin(SuchLocalMusicPlugin.class);
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(FloatingLyricPlugin.class);
        registerPlugin(AppPrefsPlugin.class);
        super.onCreate(savedInstanceState);
        // 沉浸式：WebView 内容延伸到状态栏与导航栏区域，系统栏全透明
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        // 将系统栏/刘海安全区注入为 CSS 变量（--safe-area-inset-*），
        // 不消费 insets、不加 padding，页面真正延伸到屏幕顶端与两侧
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
            Insets bars = insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            int top = (int) (bars.top / density);
            int right = (int) (bars.right / density);
            int bottom = (int) (bars.bottom / density);
            int left = (int) (bars.left / density);
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                String js = "try{var s=document.documentElement.style;"
                        + "s.setProperty('--safe-area-inset-top','" + top + "px');"
                        + "s.setProperty('--safe-area-inset-right','" + right + "px');"
                        + "s.setProperty('--safe-area-inset-bottom','" + bottom + "px');"
                        + "s.setProperty('--safe-area-inset-left','" + left + "px');"
                        + "}catch(e){}";
                webView.evaluateJavascript(js, null);
            }
            return insets;
        });
        // 主动触发一次 insets 分发，确保首帧即注入
        getWindow().getDecorView().post(() ->
                ViewCompat.requestApplyInsets(getWindow().getDecorView()));
        // 横屏自动隐藏状态栏（粘性沉浸）
        getWindow().getDecorView().post(this::applySystemBarsForOrientation);
    }

    /**
     * 横屏：隐藏状态栏，顶部下滑仅短暂显示并自动隐藏（BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE），
     * 避免状态栏常驻导致注入的 --sat 跳变、挤压页面布局；
     * 竖屏：恢复显示状态栏。
     */
    private void applySystemBarsForOrientation() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        boolean landscape = getResources().getConfiguration().orientation
                == Configuration.ORIENTATION_LANDSCAPE;
        if (landscape) {
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.statusBars());
        } else {
            controller.show(WindowInsetsCompat.Type.statusBars());
        }
    }

    @Override
    public void onConfigurationChanged(@NonNull Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarsForOrientation();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 重回前台时重新应用，防止系统恢复状态栏
        if (hasFocus) {
            applySystemBarsForOrientation();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // 保持 WebView 活跃，使音乐在后台继续播放（BridgeActivity.onPause 会暂停 WebView）
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            webView.onResume();
        }
    }
}
