import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import LocalMusicView from '../views/LocalMusicView.vue'
import PlaylistView from '../views/PlaylistView.vue'
import PlaylistDetailView from '../views/PlaylistDetailView.vue'
import RecentPlayView from '../views/RecentPlayView.vue'
import PlaylistSquareView from '../views/PlaylistSquareView.vue'
import ToplistView from '../views/ToplistView.vue'
import SearchView from '../views/SearchView.vue'
import DesktopLyricView from '../views/DesktopLyricView.vue'
import TaskbarLyricView from '../views/TaskbarLyricView.vue'
import MainLayout from '../layout/MainLayout.vue'
import MobileLayout from '../layout/MobileLayout.vue'
import { isNativeMobile } from '../platform'

// 移动端视图
import MobileHomeView from '../mobile/views/MobileHomeView.vue'
import MobileLocalMusicView from '../mobile/views/MobileLocalMusicView.vue'
import MobilePlaylistView from '../mobile/views/MobilePlaylistView.vue'
import MobilePlaylistDetailView from '../mobile/views/MobilePlaylistDetailView.vue'
import MobileRecentView from '../mobile/views/MobileRecentView.vue'
import MobileSquareView from '../mobile/views/MobileSquareView.vue'
import MobileToplistView from '../mobile/views/MobileToplistView.vue'
import MobileSearchView from '../mobile/views/MobileSearchView.vue'
import MobileOnlinePlaylistView from '../mobile/views/MobileOnlinePlaylistView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: isNativeMobile ? MobileLayout : MainLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: isNativeMobile ? MobileHomeView : HomeView
        },
        {
          path: 'local',
          name: 'local',
          component: isNativeMobile ? MobileLocalMusicView : LocalMusicView
        },
        {
          path: 'playlist',
          name: 'playlist',
          component: isNativeMobile ? MobilePlaylistView : PlaylistView
        },
        {
          path: 'playlist/:id',
          name: 'playlist-detail',
          component: isNativeMobile ? MobilePlaylistDetailView : PlaylistDetailView
        },
        {
          path: 'recent',
          name: 'recent',
          component: isNativeMobile ? MobileRecentView : RecentPlayView
        },
        {
          path: 'playlist-square',
          name: 'playlist-square',
          component: isNativeMobile ? MobileSquareView : PlaylistSquareView
        },
        {
          path: 'toplist',
          name: 'toplist',
          component: isNativeMobile ? MobileToplistView : ToplistView
        },
        {
          path: 'search',
          name: 'search',
          component: isNativeMobile ? MobileSearchView : SearchView
        },
        {
          // 在线歌单详情（移动端新增）
          path: 'online-playlist/:id',
          name: 'online-playlist',
          component: MobileOnlinePlaylistView
        },
        {
          // 设置（移动端）
          path: 'settings',
          name: 'settings',
          component: () => import('../mobile/views/settings/MobileSettingsHome.vue')
        },
        {
          path: 'settings/:section',
          name: 'settings-section',
          component: () => import('../mobile/views/settings/MobileSettingsSection.vue')
        }
      ]
    },
    {
      path: '/desktop-lyric',
      name: 'desktop-lyric',
      component: DesktopLyricView
    },
    {
      path: '/taskbar-lyric',
      name: 'taskbar-lyric',
      component: TaskbarLyricView
    }
  ]
})

export default router
