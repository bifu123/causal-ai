@echo off
setlocal

:: 使用 pushd 解决 UNC 路径问题，它会自动分配一个临时的盘符（如 Z:）
pushd "\\192.168.66.39\root\root\causal_ai\"

:: 1. 解决目录所有权信任问题
:: 这一步是关键，解决 fatal: detected dubious ownership
git config --global --add safe.directory "*"

:: 2. 检查并清理 Git 锁
if exist ".git\index.lock" (
    echo [系统] 发现 Git 进程锁，正在自动清理...
    del /f /q ".git\index.lock"
)

:: 3. 检查 .gitignore
if not exist ".gitignore" (
    echo .causal_ai/ > .gitignore
    echo [提示] 已创建 .gitignore 并排除 .causal_ai 目录
)

:: 4. 执行 Git 职责
git add .
git commit -m "debug: fix path and security ownership issues"
git push origin main

:: 返回原始目录并卸载临时盘符
popd

echo 任务完成！
pause