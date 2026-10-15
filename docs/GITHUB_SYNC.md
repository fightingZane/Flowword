# 手动同步 GitHub

此次由用户执行 Git 操作。文档整理不替用户执行 add、commit、remote add 或 push。

整理前检查：当前分支 master，已有提交历史，未配置远程仓库。完成整理后会出现文档移动、README 修改及新增截图，属于预期变化。

## 1 创建空仓库

在 GitHub 创建名为 flowword 的仓库，建议首次先用 Private。Description 可填写：

> 英语视频学习浏览器扩展：悬浮暂停、语境翻译、句子重听和可溯源词本

不要初始化 README、.gitignore 或 License，因为本地已经有 Git 历史。复制新仓库的 HTTPS 地址。

## 2 本地查看并提交

在 PowerShell 中执行，第一行路径按本机实际位置填写。

```powershell
Set-Location 'D:\04_AI_working_space\02_codex_gpt_part\02_video_english_learning'    # 进入当前项目
git status --short                                                              # 检查本次变化
git diff --stat                                                                 # 查看已跟踪文件变化概览
git add -A                                                                      # 将确认后的源码与文档纳入本次提交
git diff --cached --stat                                                        # 核对暂存内容，目录归档会识别为改名
git commit -m "docs: organize FlowWord 0.5.1 project for GitHub"                   # 只提交到本地
```

git diff --stat 不包含尚未跟踪的新文件，所以还要看 git status 与暂存后的概览。当前应提交源码、测试、文档和小型演示截图；依赖、浏览器资料、生成包、个人备份不提交。

若提示作者身份未设置，先在本仓库设置 git config user.name 和 git config user.email，再重新 commit。邮箱可使用自己 GitHub 设置中提供的 noreply 地址；不需要修改全局配置。

## 3 关联并推送

下面的 YOUR-NAME 必须换成自己的 GitHub 用户名，仓库地址以网页复制的为准。

```powershell
git remote add origin https://github.com/YOUR-NAME/flowword.git    # 给远程仓库取名 origin
git remote -v                                                   # 检查 fetch 与 push 地址
git push -u origin master                                       # 推送当前 master 及提交历史并建立跟踪
```

保留当前 master，避免首次同步额外改分支名。不要再次 git init。若远程不是空仓库、已有 origin 或推送被拒绝，先检查原因，不要用强制推送覆盖。

认证按 Git 自身提示完成。当前项目接口 Key 与 GitHub 登录无关，不要把任何令牌发到聊天里。

## 4 验证结果和以后同步

```powershell
git status -sb      # 应显示 master 跟踪 origin/master，且无待提交修改
```

刷新 GitHub 仓库，确认 README、docs、entrypoints、src 和 tests 出现，且 README 中两张图片正常显示。

以后单机更新：检查变化 → git add -A → git commit → git push。如果另一个设备或 GitHub 网页也改了内容，先处理远程变化，再推送，不要用强制推送消除冲突。

ZIP 可上传到 GitHub Releases。Git 同步的是项目源码和历史，不会同步本机扩展 IndexedDB 的 API Key、词本与设置；个人数据需要单独导出备份。

官方参考：[将本地代码添加到 GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)、[管理远程仓库](https://docs.github.com/en/get-started/git-basics/managing-remote-repositories)
