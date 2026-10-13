import { createRoot, type Root } from 'react-dom/client';
import { browser, type Browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { YouTubeSubtitleAdapter, YouTubeVideoController, videoKey } from '../src/adapters/youtube';
import { InteractionController } from '../src/core/interaction-controller';
import type { PageStatus, Settings } from '../src/core/types';
import { readSettings, STORAGE, writeSetting } from '../src/storage/settings';
import { FloatingApp } from '../src/ui/FloatingApp';
import '../src/ui/floating.css';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],   // 不在其他网站注入脚本或申请访问权限
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    let settings = await readSettings();
    const videos = new YouTubeVideoController();
    const subtitles = new YouTubeSubtitleAdapter(videos);
    const controller = new InteractionController(videos, subtitles);
    let root: Root | undefined;
    let mounted = false;
    let currentVideoKey = videoKey();
    let boundVideo: HTMLVideoElement | null = null;
    const mediaEvents = ['play', 'seeking', 'emptied', 'loadstart', 'ended'];

    function render() {
      root?.render(<FloatingApp controller={controller} settings={settings}
        onPosition={(position) => writeSetting('position', position)}
        onOffset={(offset) => writeSetting('offset', offset)} />);
    }

    const ui = await createShadowRootUi(ctx, {
      name: 'flowword-ui',
      position: 'inline',
      anchor: 'body',
      isolateEvents: ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'pointercancel'],
      onMount(container) {
        const app = document.createElement('div');
        container.append(app);
        root = createRoot(app);
        render();
      },
      onRemove() {
        root?.unmount();
        root = undefined;
      },
    });

    function mediaChanged(event?: Event) {
      if (event?.type === 'play' && controller.getSnapshot().phase === 'RESUME') return;
      controller.reset();
      subtitles.reset();
    }

    function bindVideo(next: HTMLVideoElement | null) {
      if (next === boundVideo) return;
      if (boundVideo) mediaEvents.forEach((event) => boundVideo!.removeEventListener(event, mediaChanged));
      mediaChanged();
      boundVideo = next;
      if (boundVideo) mediaEvents.forEach((event) => boundVideo!.addEventListener(event, mediaChanged));
    }

    function reparent() {
      if (!mounted) return;
      const fullscreen = document.fullscreenElement;
      if (fullscreen?.tagName === 'VIDEO') {
        ui.shadowHost.hidden = true;   // 单独 video 元素全屏无法容纳悬浮 UI，明确列入支持限制
        return;
      }
      ui.shadowHost.hidden = false;
      const anchor = fullscreen ?? document.body;
      if (ui.shadowHost.parentElement !== anchor) anchor.append(ui.shadowHost);
    }

    function reconcile() {
      const key = videoKey();
      const enabled = settings.enabled && Boolean(key);
      if (key !== currentVideoKey) {
        controller.reset();
        subtitles.reset();
        currentVideoKey = key;
      }
      if (enabled && !mounted) { ui.mount(); mounted = true; reparent(); }
      if (!enabled && mounted) { controller.reset(); subtitles.reset(); ui.remove(); mounted = false; }
      bindVideo(enabled ? videos.current() : null);
      if (enabled) subtitles.sample();   // 关闭插件时不读取视频或字幕
    }

    const changed = async (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !Object.values(STORAGE).some((key) => key in changes)) return;
      try {
        settings = await readSettings();
        reconcile();
        render();
      } catch (error) { console.warn('FlowWord 设置读取失败', error); }
    };

    const ping = (message: unknown): Promise<PageStatus> | undefined => {
      if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'FLOWWORD_PING') return;
      return Promise.resolve({ type: 'FLOWWORD_STATUS', isVideoPage: Boolean(videoKey()), enabled: settings.enabled,
        phase: controller.getSnapshot().phase, version: browser.runtime.getManifest().version });
    };

    browser.storage.onChanged.addListener(changed);
    browser.runtime.onMessage.addListener(ping);
    ctx.addEventListener(document, 'fullscreenchange', reparent);
    ctx.addEventListener(document, 'yt-navigate-start', () => { controller.reset(); subtitles.reset(); });
    ctx.addEventListener(document, 'yt-navigate-finish', reconcile);
    ctx.setInterval(reconcile, 150);   // 短时采样不依赖后台 Service Worker 常驻
    ctx.onInvalidated(() => {
      browser.storage.onChanged.removeListener(changed);
      browser.runtime.onMessage.removeListener(ping);
      bindVideo(null);
      controller.dispose();
      subtitles.reset();
      ui.remove();
    });
    reconcile();
  },
});
