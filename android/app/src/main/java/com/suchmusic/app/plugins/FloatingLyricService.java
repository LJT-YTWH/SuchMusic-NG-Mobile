package com.suchmusic.app.plugins;

import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 悬浮窗歌词服务：
 * - full 模式：双行歌词 + 控制按钮（对应桌面端"桌面歌词"）
 * - mini 模式：单行紧凑歌词条（对应桌面端"任务栏歌词"）
 */
public class FloatingLyricService extends Service {

    static FloatingLyricService instance;

    private WindowManager windowManager;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, OverlayHolder> overlays = new HashMap<>();

    private static class LyricLine {
        float time;
        String text;
        String ttext;
    }

    private static class OverlayHolder {
        View root;
        TextView currentLine;
        TextView nextLine;
        TextView infoView;
        LinearLayout controls;
        ImageButton btnPlayPause;
        WindowManager.LayoutParams params;
        List<LyricLine> lines = new ArrayList<>();
        int currentIndex = -1;
        boolean playing = false;
        boolean locked = false;
        boolean shown = false;
        // 锁定态双击解锁：记录上次点击时间（1 秒内两次点击即解锁）
        long lastTapTime = 0;
        String mode;
        // 设置
        float fontSize = 18f;
        int fontColor = Color.WHITE;
        int highlightColor = Color.parseColor("#2C8EFD");
        float opacity = 0.5f;
        boolean showNextLine = true;
        int align = Gravity.CENTER;
        String title = "";
        String artist = "";
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
    }

    @Override
    public void onDestroy() {
        mainHandler.post(() -> {
            for (OverlayHolder h : overlays.values()) {
                if (h.shown) windowManager.removeView(h.root);
                h.shown = false;
            }
            overlays.clear();
        });
        instance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ==================== 公开 API（主线程调度） ====================

    void showOverlay(String mode) {
        mainHandler.post(() -> {
            OverlayHolder h = getOrCreate(mode);
            if (!h.shown) {
                windowManager.addView(h.root, h.params);
                h.shown = true;
            }
        });
    }

    void hideOverlay(String mode) {
        mainHandler.post(() -> {
            OverlayHolder h = overlays.get(mode);
            if (h != null && h.shown) {
                windowManager.removeView(h.root);
                h.shown = false;
            }
        });
    }

    boolean isOverlayShown(String mode) {
        OverlayHolder h = overlays.get(mode);
        return h != null && h.shown;
    }

    void updateLyrics(String mode, JSArray linesArr) {
        mainHandler.post(() -> {
            OverlayHolder h = getOrCreate(mode);
            h.lines.clear();
            h.currentIndex = -1;
            if (linesArr != null) {
                for (int i = 0; i < linesArr.length(); i++) {
                    try {
                        JSONObject o = linesArr.getJSONObject(i);
                        LyricLine line = new LyricLine();
                        line.time = (float) o.optDouble("time", 0);
                        line.text = o.optString("text", "");
                        line.ttext = o.optString("ttext", "");
                        if (!line.text.trim().isEmpty()) h.lines.add(line);
                    } catch (Exception ignored) {}
                }
            }
            applyLyricAtTime(h, lastTime.getOrDefault(mode, 0f));
        });
    }

    private final Map<String, Float> lastTime = new HashMap<>();

    void updateTime(String mode, float time) {
        lastTime.put(mode, time);
        mainHandler.post(() -> {
            OverlayHolder h = overlays.get(mode);
            if (h != null && h.shown) applyLyricAtTime(h, time);
        });
    }

    void updatePlaying(String mode, boolean playing) {
        mainHandler.post(() -> {
            OverlayHolder h = overlays.get(mode);
            if (h == null) return;
            h.playing = playing;
            h.btnPlayPause.setImageResource(playing
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play);
        });
    }

    void updateInfo(String mode, String title, String artist) {
        mainHandler.post(() -> {
            OverlayHolder h = overlays.get(mode);
            if (h == null) return;
            h.title = title != null ? title : "";
            h.artist = artist != null ? artist : "";
            refreshInfo(h);
        });
    }

    void updateSettings(String mode, JSObject s) {
        mainHandler.post(() -> {
            OverlayHolder h = getOrCreate(mode);
            if (s.has("fontSize")) h.fontSize = (float) s.optDouble("fontSize", h.fontSize);
            if (s.has("fontColor")) h.fontColor = parseColor(s.getString("fontColor"), h.fontColor);
            if (s.has("highlightColor")) h.highlightColor = parseColor(s.getString("highlightColor"), h.highlightColor);
            if (s.has("opacity")) h.opacity = (float) s.optDouble("opacity", h.opacity);
            if (s.has("showNextLine")) h.showNextLine = s.getBool("showNextLine");
            if (s.has("align")) h.align = alignOf(s.getString("align"));
            if (s.has("locked")) h.locked = s.getBool("locked");
            applySettings(h);
        });
    }

    // ==================== 内部实现 ====================

    private int parseColor(String color, int fallback) {
        if (color == null || color.isEmpty()) return fallback;
        try {
            return Color.parseColor(color);
        } catch (Exception e) {
            return fallback;
        }
    }

    private int alignOf(String align) {
        if ("left".equals(align)) return Gravity.START;
        if ("right".equals(align)) return Gravity.END;
        return Gravity.CENTER;
    }

    private void refreshInfo(OverlayHolder h) {
        if (h.infoView == null) return;
        String info = h.title;
        if (!h.artist.isEmpty()) info += " - " + h.artist;
        h.infoView.setText(info);
    }

    private void applyLyricAtTime(OverlayHolder h, float time) {
        int idx = -1;
        for (int i = 0; i < h.lines.size(); i++) {
            if (h.lines.get(i).time <= time) idx = i;
            else break;
        }
        if (idx == h.currentIndex) return;
        h.currentIndex = idx;

        String cur = idx >= 0 ? h.lines.get(idx).text : (h.title.isEmpty() ? "SuchMusic" : h.title);
        if (idx >= 0 && h.showNextLine && !h.lines.get(idx).ttext.isEmpty()) {
            cur += "\n" + h.lines.get(idx).ttext;
        }
        h.currentLine.setText(cur);

        if (h.showNextLine) {
            String next = "";
            if (idx + 1 < h.lines.size()) next = h.lines.get(idx + 1).text;
            h.nextLine.setText(next);
            h.nextLine.setVisibility(View.VISIBLE);
        } else {
            h.nextLine.setVisibility(View.GONE);
        }
    }

    private OverlayHolder getOrCreate(String mode) {
        OverlayHolder h = overlays.get(mode);
        if (h != null) return h;
        h = createOverlay(mode);
        overlays.put(mode, h);
        return h;
    }

    private OverlayHolder createOverlay(String mode) {
        OverlayHolder h = new OverlayHolder();
        h.mode = mode;
        boolean mini = "mini".equals(mode);
        if (mini) {
            h.fontSize = 13f;
            h.showNextLine = false;
        }

        // 根布局
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(Math.round(h.opacity * 180), 10, 10, 10));
        bg.setCornerRadius(dp(24));
        root.setBackground(bg);
        root.setPadding(dp(16), dp(8), dp(16), dp(8));

        // 歌词区
        LinearLayout lyricBox = new LinearLayout(this);
        lyricBox.setOrientation(LinearLayout.VERTICAL);
        lyricBox.setGravity(Gravity.CENTER);

        h.currentLine = new TextView(this);
        h.currentLine.setText("SuchMusic");
        h.currentLine.setTextSize(h.fontSize);
        h.currentLine.setTextColor(h.highlightColor);
        h.currentLine.setGravity(Gravity.CENTER);
        h.currentLine.setMaxLines(2);
        lyricBox.addView(h.currentLine);

        h.nextLine = new TextView(this);
        h.nextLine.setTextSize(h.fontSize * 0.75f);
        h.nextLine.setTextColor(h.fontColor);
        h.nextLine.setAlpha(0.7f);
        h.nextLine.setGravity(Gravity.CENTER);
        h.nextLine.setMaxLines(1);
        lyricBox.addView(h.nextLine);
        root.addView(lyricBox);

        // 控制区（mini 模式也保留，紧凑排列）
        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER);
        h.controls = controls;

        h.btnPlayPause = makeButton(android.R.drawable.ic_media_play);
        ImageButton btnPrev = makeButton(android.R.drawable.ic_media_previous);
        ImageButton btnNext = makeButton(android.R.drawable.ic_media_next);
        ImageButton btnLock = makeButton(android.R.drawable.ic_lock_lock);
        ImageButton btnClose = makeButton(android.R.drawable.ic_menu_close_clear_cancel);

        btnPrev.setOnClickListener(v -> notifyControl("prev", h.mode));
        h.btnPlayPause.setOnClickListener(v -> notifyControl("toggle", h.mode));
        btnNext.setOnClickListener(v -> notifyControl("next", h.mode));
        btnLock.setOnClickListener(v -> notifyControl("toggle-lock", h.mode));
        btnClose.setOnClickListener(v -> {
            hideOverlay(h.mode);
            notifyControl("close", h.mode);
        });

        controls.addView(btnPrev);
        controls.addView(h.btnPlayPause);
        controls.addView(btnNext);
        controls.addView(btnLock);
        controls.addView(btnClose);
        root.addView(controls);

        // 窗口参数
        int type = Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.y = mini ? dp(4) : dp(80);
        h.params = params;
        h.root = root;

        // 拖动
        root.setOnTouchListener(new View.OnTouchListener() {
            float startX, startY;
            int startParamX, startParamY;
            boolean moved;

            @Override
            public boolean onTouch(View v, MotionEvent event) {
                // 锁定态：禁止拖动，但保持可触摸——1 秒内快速点击 2 次直接解除锁定
                if (h.locked) {
                    switch (event.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            startX = event.getRawX();
                            startY = event.getRawY();
                            moved = false;
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            if (Math.abs(event.getRawX() - startX) > 12
                                    || Math.abs(event.getRawY() - startY) > 12) {
                                moved = true;
                            }
                            return true;
                        case MotionEvent.ACTION_UP:
                            if (!moved) {
                                long now = System.currentTimeMillis();
                                if (now - h.lastTapTime <= 1000) {
                                    h.lastTapTime = 0;
                                    h.locked = false;
                                    applySettings(h);
                                    // 同步前端锁定状态，由前端回推设置保持一致
                                    notifyControl("toggle-lock", h.mode);
                                } else {
                                    h.lastTapTime = now;
                                }
                            }
                            return true;
                        default:
                            return true;
                    }
                }
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        startX = event.getRawX();
                        startY = event.getRawY();
                        startParamX = h.params.x;
                        startParamY = h.params.y;
                        moved = false;
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = event.getRawX() - startX;
                        float dy = event.getRawY() - startY;
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
                        if (moved) {
                            h.params.x = startParamX + (int) dx;
                            h.params.y = startParamY + (int) dy;
                            params.gravity = Gravity.TOP | Gravity.START;
                            if (h.shown) windowManager.updateViewLayout(h.root, h.params);
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        return moved;
                }
                return false;
            }
        });

        applySettings(h);
        return h;
    }

    private ImageButton makeButton(int iconRes) {
        ImageButton btn = new ImageButton(this);
        btn.setImageResource(iconRes);
        btn.setBackgroundColor(Color.TRANSPARENT);
        btn.setColorFilter(Color.WHITE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(36), dp(36));
        btn.setLayoutParams(lp);
        btn.setPadding(dp(4), dp(4), dp(4), dp(4));
        return btn;
    }

    private void applySettings(OverlayHolder h) {
        h.currentLine.setTextSize(h.fontSize);
        h.currentLine.setTextColor(h.highlightColor);
        h.nextLine.setTextSize(h.fontSize * 0.75f);
        h.nextLine.setTextColor(h.fontColor);
        h.currentLine.setGravity(h.align);
        h.nextLine.setGravity(h.align);
        h.nextLine.setVisibility(h.showNextLine ? View.VISIBLE : View.GONE);
        h.controls.setVisibility(h.locked ? View.GONE : View.VISIBLE);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(Math.round(h.opacity * 180), 10, 10, 10));
        bg.setCornerRadius(dp(24));
        h.root.setBackground(bg);

        // 锁定时保持可触摸（不再设置 FLAG_NOT_TOUCHABLE）：
        // 点击穿透会导致锁定后无法通过任何手势解除锁定（旧 bug），
        // 现在改为锁定态禁止拖动、1 秒内双击悬浮歌词区域即可解除锁定
        if (h.shown) windowManager.updateViewLayout(h.root, h.params);
    }

    private void notifyControl(String action, String mode) {
        if (FloatingLyricPlugin.instance != null) {
            FloatingLyricPlugin.instance.notifyControl(action, mode);
        }
    }

    private int dp(float v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
