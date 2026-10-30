$ErrorActionPreference = "Stop"
Push-Location $PSScriptRoot
try {
    python -m pip install -e '.[build]'
    if ($LASTEXITCODE -ne 0) { throw "패키지 설치 실패" }
    python -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw "검증 실패" }
    python -m PyInstaller --noconfirm --clean --onefile --noconsole --name InventoryLedger2022 --paths src --exclude-module PyQt5 --exclude-module PyQt6 --exclude-module tkinter --exclude-module matplotlib --exclude-module scipy --exclude-module IPython --exclude-module notebook run_app.py
    if ($LASTEXITCODE -ne 0) { throw "EXE 빌드 실패" }
    Write-Host "완료: $PSScriptRoot/dist/InventoryLedger2022.exe"
} finally {
    Pop-Location
}
