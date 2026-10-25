<script setup lang="ts">
// 关于：版本信息与开源声明
</script>

<template>
  <div class="sp-panel">
    <div class="about-hero">
      <div class="about-logo-ring">
        <img src="@renderer/assets/icon.png" class="about-logo-img" />
      </div>
      <div class="about-name">SuchMusic</div>
      <div class="about-slogan">让音乐更纯粹</div>
      <div class="about-ver-pill">V1.5.2-安卓-社区版</div>
    </div>

    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label"><i class="mgc_github_line row-ic about-ic"></i>电脑版原项目地址</span>
        <span class="row-value link">github.com/Enzymeym/SuchMusic-NG</span>
      </div>
      <div class="setting-row">
        <span class="row-label"><i class="mgc_user_3_line row-ic about-ic"></i>电脑版移植作者</span>
        <span class="row-value">柠檬桶</span>
      </div>
      <div class="setting-row">
        <span class="row-label"><i class="mgc_code_line row-ic about-ic"></i>技术栈</span>
        <span class="row-value">Vue 3 · Capacitor 8</span>
      </div>
      <div class="setting-row">
        <span class="row-label"><i class="mgc_music_2_line row-ic about-ic"></i>音源方式</span>
        <span class="row-value">插件化 · 用户自配</span>
      </div>
    </div>

    <div class="mp-section-title">官方交流群</div>
    <div class="mp-list setting-list">
      <div class="setting-row">
        <span class="row-label"><i class="mgc_group_line row-ic about-ic"></i>QQ 群号</span>
        <span class="row-value">677063599</span>
      </div>
    </div>

    <div class="about-legal">
      <i class="mgc_information_line"></i>
      <span>
        本应用仅提供音乐搜索与播放工具，不存储任何版权音乐内容。所有音源均来自用户自行配置的插件与公开接口，请于下载后
        24 小时内删除相关内容，支持正版音乐。
      </span>
    </div>
  </div>
</template>
