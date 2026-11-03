@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ========================================================
echo   満正寺式 九曜星占盤アプリ - GitHub アップロードツール
echo ========================================================
echo.
echo 1. ブラウザで https://github.com/new を開いて空のリポジトリを作成してください
echo    （例：リポジトリ名 kuyosei-app / Public 推奨）
echo 2. 作成したリポジトリのURL（https://github.com/ユーザー名/kuyosei-app.git）を貼り付けてください
echo.
set /p REPO_URL="GitHubリポジトリURLを入力: "
if "%REPO_URL%"=="" (
    echo URLが入力されませんでした。終了します。
    pause
    exit /b 1
)
git remote remove origin >nul 2>&1
git remote add origin "%REPO_URL%"
git branch -M main
echo.
echo GitHubへプッシュしています...（認証画面が出た場合はログインしてください）
git push -u origin main
echo.
echo ========================================================
echo 完了しました！
echo GitHubのリポジトリ画面で [Settings] -^> [Pages] -^> Branchを [main] にして Save すると
echo 友達にLINE等で送れる公開Web URLが発行されます！
echo ========================================================
pause
