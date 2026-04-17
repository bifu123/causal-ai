@echo off
SETLOCAL
:: 1. 定义业务变量
SET "UNC_PATH=\\192.168.66.39\root\root\causal_ai"
SET "PROXY_URL=http://127.0.0.1:65532"
SET "REPO_URL=https://github.com/bifu123/causal-ai"

echo [INFO] 正在处理网络路径映射...
:: 2. 自动映射 UNC 路径到临时盘符并进入
pushd "%UNC_PATH%"
if %errorlevel% neq 0 (
    echo [ERROR] 无法访问网络路径: %UNC_PATH%
    pause
    exit /b
)

echo [INFO] 当前工作目录已切换至: %CD%

:: 3. 临时设置 Git 代理并直接克隆到当前目录
echo [INFO] 正在克隆仓库 (使用代理: %PROXY_URL%)...
:: 注意末尾的 "."，代表直接将代码克隆到当前工作目录
git clone -c http.proxy=%PROXY_URL% -c https.proxy=%PROXY_URL% %REPO_URL% .

if %errorlevel% eq 0 (
    echo [SUCCESS] 仓库克隆成功！
) else (
    echo [ERROR] 克隆失败，请检查网络、代理设置，或确保当前目录为空。
)

:: 4. 清理：卸载临时盘符并返回原目录
echo [INFO] 正在清理临时映射...
popd

pause