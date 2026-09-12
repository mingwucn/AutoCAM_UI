param(
  [ValidateSet('native','wasm')][string]$Target = 'native',
  [string]$WorkDirectory = (Join-Path $PSScriptRoot '../.cache/brep'),
  [string]$EmsdkDirectory,
  [int]$Parallel = 4
)
$ErrorActionPreference = 'Stop'
function Run-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}
if ($Parallel -lt 1) { throw 'Parallel must be positive.' }
$brepWork = [IO.Path]::GetFullPath($WorkDirectory)
$occtSource = Join-Path $brepWork 'OCCT'
$occtBuild = Join-Path $brepWork "occt-$Target"
$coreBuild = Join-Path $brepWork "build-$Target"
$sourcePin = 'bd2a789f15235755ce4d1a3b07379a2e062fdc2e'
if (!(Test-Path -LiteralPath $occtSource)) {
  Run-Checked git @('clone','--depth','1','--branch','V7_8_1',
    'https://github.com/Open-Cascade-SAS/OCCT.git',$occtSource)
}
$currentPin = & git -C $occtSource rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $currentPin.Trim() -ne $sourcePin) {
  throw 'The OCCT source checkout does not match the required revision.'
}
$occtChanges = & git -C $occtSource status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $occtChanges) { throw 'The OCCT source checkout has tracked modifications.' }
$toolchain = @()
$priorEmConfig = $env:EM_CONFIG
try {
  if ($Target -eq 'wasm') {
    if (!$EmsdkDirectory) { throw 'EmsdkDirectory is required for a WASM build.' }
    $env:EM_CONFIG = (Resolve-Path (Join-Path $EmsdkDirectory '.emscripten')).Path
    $toolchain = @('-DCMAKE_TOOLCHAIN_FILE=' +
      (Resolve-Path (Join-Path $EmsdkDirectory 'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake')).Path)
  }
  Run-Checked cmake (@('-S',$occtSource,'-B',$occtBuild,'-G','Ninja',
    '-DCMAKE_BUILD_TYPE=Release','-DBUILD_LIBRARY_TYPE=Static',
    '-DBUILD_MODULE_Visualization=OFF','-DBUILD_MODULE_ApplicationFramework=OFF',
    '-DBUILD_MODULE_DataExchange=OFF','-DBUILD_MODULE_DETools=OFF','-DBUILD_MODULE_Draw=OFF',
    '-DUSE_TBB=OFF','-DUSE_TK=OFF','-DUSE_FREETYPE=OFF',
    '-DBUILD_ADDITIONAL_TOOLKITS=TKDESTEP TKBinXCAF') + $toolchain)
  Run-Checked cmake @('--build',$occtBuild,'--target','TKernel','TKMath','TKG2d','TKG3d',
    'TKGeomBase','TKBRep','TKGeomAlgo','TKTopAlgo','TKPrim','TKBO','TKBool','TKShHealing',
    'TKMesh','TKHLR','TKDESTEP','TKXSBase','TKDE','--parallel',"$Parallel")
  Run-Checked cmake (@('-S',(Join-Path $PSScriptRoot '../core/brep'),'-B',$coreBuild,
    '-G','Ninja','-DCMAKE_BUILD_TYPE=Release',"-DAUTOCAM_OCCT_BUILD=$occtBuild") + $toolchain)
  Run-Checked cmake @('--build',$coreBuild,'--parallel',"$Parallel")
  Run-Checked ctest @('--test-dir',$coreBuild,'--output-on-failure')
} finally {
  $env:EM_CONFIG = $priorEmConfig
}
