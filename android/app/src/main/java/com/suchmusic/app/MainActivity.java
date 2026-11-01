package com.suchmusic.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.suchmusic.app.plugins.AppPrefsPlugin;
import com.suchmusic.app.plugins.FileExportPlugin;
import com.suchmusic.app.plugins.FloatingLyricPlugin;
import com.suchmusic.app.plugins.MediaSessionPlugin;
import com.suchmusic.app.plugins.SuchLocalMusicPlugin;

public class MainActivity extends BridgeActivity {

    /**
     * 是否运行在电视设备上（Android TV / Google TV / 电视盒子）。
     * 电视没有触摸屏，交互全靠遥控器方向键 + OK + 返回，Web 端据此启用空间导航。
     */
    private boolean isTelevision = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 注册自定义原生插件
        registerPlugin(SuchLocalMusicPlugin.class);
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(FloatingLyricPlugin.class);
        registerPlugin(AppPrefsPlugin.class);
        registerPlugin(FileExportPlugin.class);
        super.onCreate(savedInstanceState);
        // 电视环境识别（uiMode 由系统根据设备类型给出，比 UA 判断更可靠）
        isTelevision = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION;
        WebView bridgeView = getBridge() != null ? getBridge().getWebView() : null;
        if (bridgeView != null) {
            // 暴露给 Web 端：window.SuchTvInfo.isTv()
            bridgeView.addJavascriptInterface(new TvInfoBridge(), "SuchTvInfo");
            if (isTelevision) {
                // 遥控器方向键必须落在 WebView 上才能变成 DOM 键盘事件
                bridgeView.setFocusable(true);
                bridgeView.setFocusableInTouchMode(true);
                bridgeView.setBackgroundColor(Color.BLACK);
            }
        }
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
        // 电视：首帧后把焦点交给 WebView，否则遥控器方向键会被 DecorView 吞掉
        if (isTelevision) {
            getWindow().getDecorView().post(this::requestWebViewFocus);
        }
    }

    /** 把输入焦点交给 WebView（电视遥控器方向键依赖它） */
    private void requestWebViewFocus() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        if (!webView.hasFocus()) webView.requestFocus();
    }

    /**
     * 遥控器媒体键（播放/暂停、上一首、下一首）转给 Web 端的播放器。
     * 其它按键（方向键、返回键、OK）保持系统默认流转：
     * 方向键/OK 由 WebView 转成 DOM 键盘事件交给空间导航，返回键走 onBackPressed 的既有逻辑。
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (isTelevision && event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            String action = mediaActionForKey(event.getKeyCode());
            if (action != null && dispatchMediaActionToWeb(action)) return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private String mediaActionForKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                return "toggle";
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return "pause";
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                return "next";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                return "prev";
            default:
                return null;
        }
    }

    private boolean dispatchMediaActionToWeb(String action) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return false;
        String js = "try{window.dispatchEvent(new CustomEvent('tv:media',{detail:'" + action + "'}));}catch(e){}";
        webView.evaluateJavascript(js, null);
        return true;
    }

    /** 暴露给 Web 端的电视环境信息：window.SuchTvInfo.isTv() */
    public class TvInfoBridge {
        @JavascriptInterface
        public boolean isTv() {
            return isTelevision;
        }
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
            if (isTelevision) requestWebViewFocus();
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
