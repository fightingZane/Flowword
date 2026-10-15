import { createRoot, type Root } from 'react-dom/client';
import { browser, type Browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { YouTubeSubtitleAdapter, YouTubeVideoController, videoKey } from '../src/adapters/youtube';
import { GenericSubtitleAdapter, GenericVideoController } from '../src/adapters/generic';
import { latestObservedRange, prefetchItems, readTrackSegments, selectEnglishTrack, subtitleTimeline, type PrefetchItem } from '../src/adapters/html5-subtitles';
import { InteractionController } from '../src/core/interaction-controller';
import { ReplayController } from '../src/core/replay-controller';
import { assembleSentence } from '../src/core/sentence';
import { analyzeVocabulary } from '../src/core/vocabulary';
import { getCuratedMeaning } from '../src/core/curated-meanings';
import { enrichLearning } from '../src/services/learning';
import type { PageStatus, SubtitlePort, SubtitleSnapshot } from '../src/core/types';
import { readSettings, STORAGE, writeAppearance, writeSetting } from '../src/storage/settings';
import { FloatingApp } from '../src/ui/FloatingApp';
import '../src/ui/floating.css';

export default defineContentScript({
  registration: 'runtime',   // 不设置 matches，避免 WXT 把全站匹配自动升级为必选权限
  runAt: 'document_idle',
  cssInjectionMode: 'manual',
  // main 意为内容脚本启动入口，ctx 管理当前注入会话的监听和清理
  // 仅在 YouTube 静态注入或已授权站动态注册后运行，不在子框架中读取字幕
  async main(ctx) {
    if (window.top !== window) return;   // 跨域 iframe 播放器需要后续专用适配，不读取其他框架
    let settings = await readSettings();
    let settingsRevision = 0;
    if (ctx.isInvalid) return;
    const youtube = location.hostname === 'www.youtube.com';
    const videos = youtube ? new YouTubeVideoController() : new GenericVideoController();
    const subtitles = videos instanceof YouTubeVideoController ? new YouTubeSubtitleAdapter(videos) : new GenericSubtitleAdapter(videos);
    // pageKey 意为统一读取视频身份，无参数，挂载与换页时重复调用
    // 保留 YouTube 标准 watch 限制，其他站使用唯一主视频身份
    const pageKey = () => videos instanceof GenericVideoController ? videos.key() : videoKey();
    const replay = new ReplayController();
    let following = false;
    let followOwnPlay: HTMLVideoElement | null = null;
    let lastFollow = '';
    let provider: { mode?: string; model?: string; prefetch?: boolean } = {};
    let providerRevision = 0;
    let prefetchRevision = 0;
    let prefetchPending = false;
    let lastPrefetch = 0;
    let stableCaption = '';
    let stableSince = 0;
    const attemptedPrefetch = new Set<string>();

    // nearbySnapshot 意为裁剪真实邻近字幕，snapshot 是平台适配器捕获结果
    // YouTube 原生轨道补入已加载下句，DOM 不补造未来，最终只留下少量邻近片段
    function nearbySnapshot(snapshot: SubtitleSnapshot): SubtitleSnapshot {
      const video = videos.current();
      const source = snapshot.selected.source;
      const available = video && source === 'text-track' ? readTrackSegments(selectEnglishTrack(video), 'text-track') : snapshot.segments;
      const past = available.filter((item) => item.start <= snapshot.selected.start && item.end >= snapshot.selected.start - 12).slice(-6);
      const future = available.filter((item) => item.start > snapshot.selected.start).slice(0, 4);
      return { ...snapshot, segments: [...past, ...future] };
    }   // 只保留当前附近的真实字幕，不缓存或上传完整视频轨道

    const subtitlePort: SubtitlePort = {
      capture: (handle, offset) => nearbySnapshot(subtitles.capture(handle, offset)),
      previous: (context) => nearbySnapshot(subtitles.previous(context)),
    };
    const controller = new InteractionController(videos, subtitlePort, async (snapshot) => {
      const context = assembleSentence(snapshot);
      const current = await readSettings();
      const candidates = analyzeVocabulary(context.text).map((candidate) => ({ ...candidate,
        meaning: candidate.meaning ?? getCuratedMeaning(candidate.lemma)?.meaning }));   // 核验通用义可离线显示，不自动判断当前词性
      return { ...context, learning: { status: current.onlineTranslation ? 'loading' : 'disabled', candidates, timeline: subtitleTimeline(snapshot, context) } };
    }, 2500, enrichLearning);
    let root: Root | undefined;
    let mounted = false;
    let currentVideoKey = pageKey();
    let boundVideo: HTMLVideoElement | null = null;
    const mediaEvents = ['play', 'seeking', 'emptied', 'loadstart', 'ended'];

    // refreshProvider 意为刷新公开翻译配置，无参数，初始化和设置变更后调用
    // 只接收模式模型和预译开关，版本号防止旧响应覆盖新设置，不读取密钥
    async function refreshProvider() {
      const revision = ++providerRevision;
      try {
        const info = await browser.runtime.sendMessage({ type: 'FLOWWORD_PROVIDER_PUBLIC' });
        if (!ctx.isInvalid && revision === providerRevision && info?.ok) provider = { mode: info.mode, model: info.model, prefetch: info.prefetch === true };
      } catch { if (revision === providerRevision) provider = {}; }
    }   // 内容脚本只接收公开模式和开关，接口地址与密钥始终留在扩展页面和后台

    // repeatSentence 意为重听当前原句，无参数，面板按钮和浏览器快捷键共用
    // 没有面板时即时读取真实字幕，DOM 先补齐已经观测的终点，网络不参与重听
    async function repeatSentence() {
      const context = controller.getSnapshot().context;
      const snapshot = context ?? subtitlePort.capture(videos.capture(), settings.offset);
      const video = videos.current();
      if (!video || pageKey() !== snapshot.videoKey) throw new Error('视频已切换，请重新捕获');
      following = false;
      const key = snapshot.videoKey;
      const source = video.currentSrc;
      subtitles.sample();
      await replay.repeat(video, latestObservedRange(snapshot, subtitles.cache.all()), () => videos.current() === video && pageKey() === key && video.currentSrc === source,
        () => { try { controller.adoptReplayPause(); } catch { controller.reset(); } });
      if (context && replay.active) controller.rebaseHandle();   // 句末暂停属于用户主动要求的重听，新归属允许显式继续
    }

    // startFollow 意为启用字幕播放跟随，无参数，由面板明确操作启动
    // 先检查主视频，再播放并进入跟随，不把后续云端译文速度当作视频暂停条件
    async function startFollow() {
      videos.capture();   // 先验证普通视频、主对象与来源，失败时保持当前学习内容
      const video = videos.current()!;
      replay.cancel(); controller.reset();
      following = true; lastFollow = ''; followOwnPlay = video;
      try { await video.play(); }
      catch { following = false; throw new Error('浏览器未允许播放，请点击视频后再启用字幕跟随'); }
      finally { followOwnPlay = null; }
      followTick();
    }   // 用户主动启用跟随时播放，后续字幕更新不再暂停视频

    // followTick 意为处理当前跟随字幕，无参数，启用后周期调用
    // 只在真实字幕变化时分析，正常字幕间隙等待，关闭或切换页面后不重新弹出
    function followTick() {
      if (!following || !boundVideo || boundVideo.paused) return;
      try {
        const snapshot = subtitlePort.capture(videos.capture(), settings.offset);
        const key = JSON.stringify([snapshot.videoKey, snapshot.selected.start, snapshot.selected.text]);
        if (key === lastFollow) return;
        lastFollow = key;
        void controller.follow(snapshot);
      } catch { /* 正常字幕间隙等待下一条真实字幕，不生成原句 */ }
    }

    // prefetchTick 意为播放中有限预译，无参数，由采样周期调用
    // 需要联网云模式和独立预译授权，DOM 稳定后只译已出现当前句，真实轨道可加下一句
    function prefetchTick() {
      const video = boundVideo;
      if (!video || video.paused || !settings.onlineTranslation || provider.mode !== 'cloud' || !provider.prefetch || prefetchPending) return;
      try {
        const snapshot = subtitlePort.capture(videos.capture(), settings.offset);
        const current = assembleSentence(snapshot);
        const captionKey = JSON.stringify([snapshot.videoKey, current.text]);
        const now = Date.now();
        if (captionKey !== stableCaption) { stableCaption = captionKey; stableSince = now; }
        if (snapshot.selected.source === 'youtube-dom' && now - stableSince < 600 || now - lastPrefetch < 2000) return;
        const context = subtitleTimeline(snapshot, current).filter((item) => item.text !== current.text).slice(0, 2).map((item) => item.text);
        const items: PrefetchItem[] = [{ sentence: current.text, context }, ...prefetchItems(snapshot)];
        const fresh = items.filter((item) => item.sentence.length <= 2000 && !attemptedPrefetch.has(JSON.stringify([provider.model, snapshot.videoKey, item]))).slice(0, 2);
        if (!fresh.length) return;
        fresh.forEach((item) => attemptedPrefetch.add(JSON.stringify([provider.model, snapshot.videoKey, item])));
        if (attemptedPrefetch.size > 100) attemptedPrefetch.delete(attemptedPrefetch.values().next().value!);
        lastPrefetch = now; prefetchPending = true;
        const revision = prefetchRevision;
        void browser.runtime.sendMessage({ type: 'FLOWWORD_PREFETCH', items: fresh }).catch(() => {}).finally(() => {
          if (revision === prefetchRevision) prefetchPending = false;
        });
      } catch { /* 不可读字幕不触发联网，不影响普通视频播放 */ }
    }   // 默认关闭，原生字幕预译当前和下一句，DOM 只发送已经稳定出现的内容

    // unsubscribe 保存阶段监听的清理函数，监听回调无参数并读取控制器当前状态
    // IDLE 停止跟随和重听，重新捕获先退出旧播放辅助会话，失效时解除订阅
    const unsubscribe = controller.subscribe(() => {
      const phase = controller.getSnapshot().phase;
      if (phase === 'IDLE') { following = false; lastFollow = ''; replay.cancel(); }
      if (phase === 'CAPTURING') { following = false; replay.cancel(); }
    });

    // render 意为刷新悬浮界面，无参数，挂载和外观配置变更时调用
    // 只把安全的学习状态及操作回调交给网页 UI，云端密钥不会传入组件
    let requestedPanel: { view: 'provider' | 'book'; revision: number } | undefined;
    function render() {
      root?.render(<FloatingApp controller={controller} settings={settings} requestedPanel={requestedPanel}
        onPosition={(position) => writeSetting('position', position)}
        onOffset={(offset) => writeSetting('offset', offset)}
        onAppearance={writeAppearance}
        onOnlineTranslation={(value) => writeSetting('onlineTranslation', value)}
        onRepeat={repeatSentence} onFollow={startFollow} />);
    }

    const ui = await createShadowRootUi(ctx, {
      name: 'flowword-ui',
      position: 'inline',
      anchor: 'body',
      css: await (await fetch(browser.runtime.getURL('/') + 'content-scripts/flowword.css')).text(),
      isolateEvents: ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'pointercancel'],
      // onMount 意为挂载 React，container 是隔离后的 Shadow 内容容器
      // 创建一个根节点后渲染，重复挂载由 UI 生命周期保证先移除旧实例
      onMount(container) {
        const app = document.createElement('div');
        container.append(app);
        root = createRoot(app);
        render();
      },
      // onRemove 意为移除 React，无参数，关闭插件或注入失效时调用
      // 释放组件与监听，后续重新启用再创建新根节点
      onRemove() {
        root?.unmount();
        root = undefined;
      },
    });

    // mediaChanged 意为处理播放来源或时间变化，event 为可选原生视频事件
    // 只放行明确内部重听和继续事件，外部 seek、换源及手动播放清理旧内容和归属
    function mediaChanged(event?: Event) {
      if (event && replay.ownsEvent(event)) return;
      if (event?.type === 'play' && followOwnPlay === event.target && following) return;
      if (event?.type === 'play' && controller.getSnapshot().phase === 'RESUME') return;
      replay.cancel(); following = false; lastFollow = '';
      prefetchRevision++; prefetchPending = false; stableCaption = ''; attemptedPrefetch.clear();
      controller.reset();
      subtitles.reset();
    }

    // bindVideo 意为切换正在监听的主视频，next 是新对象或 null
    // 先解除旧对象监听再绑定新对象，关闭插件传 null，绝不继续操作旧视频
    function bindVideo(next: HTMLVideoElement | null) {
      if (next === boundVideo) return;
      if (boundVideo) mediaEvents.forEach((event) => boundVideo!.removeEventListener(event, mediaChanged));
      mediaChanged();
      boundVideo = next;
      if (boundVideo) mediaEvents.forEach((event) => boundVideo!.addEventListener(event, mediaChanged));
    }

    // reparent 意为把悬浮层放到当前全屏容器，无参数，在全屏变化和挂载后调用
    // 容器全屏能容纳 UI，单独 video 全屏无法添加子层时隐藏悬浮层
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

    // reconcile 意为协调开关页面和主视频，无参数，由周期及设置变化触发
    // 只在启用状态采样字幕，视频身份变化立即重置，失效会话不能重新挂载
    function reconcile() {
      if (ctx.isInvalid) return;
      const key = pageKey();
      const enabled = settings.enabled && Boolean(key);
      if (key !== currentVideoKey) {
        mediaChanged();
        currentVideoKey = key;
      }
      if (enabled && !mounted) { ui.mount(); mounted = true; reparent(); }
      if (!enabled && mounted) { mediaChanged(); ui.remove(); mounted = false; }
      bindVideo(enabled ? videos.current() : null);
      if (enabled) { subtitles.sample(); followTick(); prefetchTick(); }   // 关闭插件时不读取视频或字幕
    }

    // changed 意为接收存储变更，changes 是字段改动，area 指定存储区域
    // 仅处理本插件 local 设置，读取序号防止旧异步结果覆盖后来的开关操作
    const changed = async (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !Object.values(STORAGE).some((key) => key in changes)) return;
      const revision = ++settingsRevision;
      try {
        const next = await readSettings();
        if (ctx.isInvalid || revision !== settingsRevision) return;
        settings = next;
        reconcile();
        render();
        void refreshProvider();
      } catch (error) { console.warn('FlowWord 设置读取失败', error); }
    };

    // messages 意为接收扩展内部消息，message 提供操作，sender 用于确认本扩展身份
    // 返回安全状态或命令结果，撤权按自身 origin 筛选，不接受网页跨来源调用
    const messages = (message: unknown, sender: Browser.runtime.MessageSender): Promise<unknown> | undefined => {
      if (sender.id !== browser.runtime.id || !message || typeof message !== 'object' || !('type' in message)) return;
      if (message.type === 'FLOWWORD_PING') return Promise.resolve({ type: 'FLOWWORD_STATUS', isVideoPage: Boolean(pageKey()), enabled: settings.enabled,
        phase: controller.getSnapshot().phase, version: browser.runtime.getManifest().version } satisfies PageStatus);
      if (message.type === 'FLOWWORD_PANEL_OPEN' && 'view' in message && (message.view === 'provider' || message.view === 'book')) {
        if (!settings.enabled || !mounted || !pageKey()) return Promise.resolve({ ok: false, error: '请先开启悬浮球并打开视频页面' });
        requestedPanel = { view: message.view, revision: (requestedPanel?.revision ?? 0) + 1 };
        render(); return Promise.resolve({ ok: true });
      }
      if (message.type === 'FLOWWORD_PROVIDER_CHANGED') { attemptedPrefetch.clear(); void refreshProvider(); return Promise.resolve({ ok: true }); }
      if (message.type === 'FLOWWORD_SITE_REVOKED' && !youtube) {
        const revoked = 'origins' in message && Array.isArray(message.origins) && message.origins.includes(location.origin + '/*');
        if (revoked) ctx.abort();
        return Promise.resolve({ ok: true, revoked });
      }   // 后台撤权后只广播站点列表，无需继续读取已经失去权限的标签页网址
      if (message.type !== 'FLOWWORD_COMMAND' || !('command' in message)) return;
      return (async () => {
        if (!settings.enabled || !pageKey()) return { ok: false, error: '请先开启悬浮球并打开受支持的视频页面' };
        try {
          if (message.command === 'repeat-sentence') await repeatSentence();
          else if (message.command === 'toggle-playback') {
            if (controller.getSnapshot().phase === 'IDLE' && !controller.getSnapshot().canResume) await controller.capture(settings.offset);
            else await controller.resume();
          } else return { ok: false, error: '未知快捷键操作' };
          return { ok: true, phase: controller.getSnapshot().phase };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
      })();
    };

    browser.storage.onChanged.addListener(changed);
    browser.runtime.onMessage.addListener(messages);
    ctx.addEventListener(document, 'fullscreenchange', reparent);
    ctx.addEventListener(document, 'yt-navigate-start', () => mediaChanged());
    ctx.addEventListener(document, 'yt-navigate-finish', reconcile);
    ctx.setInterval(reconcile, 150);   // 短时采样不依赖后台 Service Worker 常驻
    ctx.onInvalidated(() => {
      browser.storage.onChanged.removeListener(changed);
      browser.runtime.onMessage.removeListener(messages);
      bindVideo(null);
      controller.dispose();
      unsubscribe(); replay.cancel();
      subtitles.reset();
      ui.remove();
    });
    const revision = ++settingsRevision;
    const latest = await readSettings();   // CSS 加载期间可能已经开关插件，注册监听后重新读取补齐初始化窗口
    if (ctx.isInvalid) return;
    if (revision === settingsRevision) settings = latest;
    reconcile();
    void refreshProvider();
  },
});
