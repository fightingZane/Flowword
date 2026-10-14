import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const built = resolve('.output/chrome-mv3');
const output = resolve(`release/FlowWord-${metadata.version}`);
const manifest = JSON.parse(await readFile(`${built}/manifest.json`, 'utf8'));
if (manifest.version !== metadata.version || manifest.manifest_version !== 3) throw new Error('构建版本与项目版本不一致，请先重新构建');
if (relative(root, output).startsWith('..')) throw new Error('输出目录必须位于项目内');
if (!/^\d+\.\d+\.\d+$/.test(metadata.version) || relative(resolve('release'), output).startsWith('..') || output === resolve('release')) throw new Error('扩展输出路径无效');
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify(['activeTab', 'scripting', 'storage'])) throw new Error('权限发生变化，先检查生产清单');
if (manifest.host_permissions.some((host) => !['https://api.mymemory.translated.net/*', 'https://www.youtube.com/*'].includes(host))) throw new Error('必选站点范围发生变化');
if (JSON.stringify([...(manifest.optional_host_permissions ?? [])].sort()) !== JSON.stringify(['http://*/*', 'https://*/*'])) throw new Error('按站授权的可选范围发生变化');
if (manifest.content_scripts.some((entry) => entry.matches.some((match) => match !== 'https://www.youtube.com/*'))) throw new Error('站点范围不符合首版约定');
const existing = await lstat(output).catch(() => null);
if (existing?.isSymbolicLink()) throw new Error('生成目录不能是符号链接');
await rm(output, { recursive: true, force: true });   // 已校验绝对路径，只重建项目内的生成目录
await mkdir(output, { recursive: true });
await cp(built, output, { recursive: true });
for (const version of ['0.1.0', '0.2.0', '0.3.0']) {
  const previous = resolve(`release/FlowWord-${version}`);
  const previousInfo = await lstat(previous).catch(() => null);
  if (previousInfo) {
    if (previousInfo.isSymbolicLink() || !previousInfo.isDirectory() || relative(resolve('release'), previous).startsWith('..')) throw new Error('旧版生成目录不安全');
    await rm(previous, { recursive: true, force: true });   // 校验项目内固定生成路径后更新，保留浏览器原加载路径
    await cp(built, previous, { recursive: true });
  }
}
await cp('INSTALL.md', 'release/安装说明.md');
await cp('TEST_REPORT.md', 'release/验证报告.md');
await cp(`.output/flowword-${metadata.version}-chrome.zip`, `release/FlowWord-${metadata.version}.zip`);
const evidence = resolve(`release/verification-${metadata.version}`);
await mkdir(evidence, { recursive: true });
for (const file of ['e2e-report.json', 'features-report.json', 'upgrade-report.json', 'archive-report.json', 'sites-report.json', 'translation-live-report.json', 'floating-light.png', 'floating-dark.png', 'floating-narrow.png', 'floating-fullscreen.png', 'popup.png', 'configuration.png', 'upgrade-v03.png', 'wordbook-v03.png', 'wordbook-dark-wide.png']) {
  await cp(resolve('test-results', file), resolve(evidence, file));   // 交付实测证据，不只留下成功结论
}
const hashes = [];
async function collect(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await collect(path);
    else hashes.push(`${createHash('sha256').update(await readFile(path)).digest('hex')}  ${relative(resolve('release'), path).replaceAll('\\', '/')}`);
  }
}
await collect(output);
const archive = resolve(`release/FlowWord-${metadata.version}.zip`);
hashes.push(`${createHash('sha256').update(await readFile(archive)).digest('hex')}  ${relative(resolve('release'), archive)}`);
await writeFile('release/SHA256SUMS.txt', hashes.sort().join('\n') + '\n');
console.log(`可加载扩展目录：${output}`);
console.log('安装说明与验证报告已复制到 release 目录');
