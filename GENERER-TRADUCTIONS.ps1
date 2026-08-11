$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$translationsDir = Join-Path $appDir 'traductions'
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

$dictionaries = @(
    @{ File = 'traductions'; Global = 'PYTHON_EN_CLAIR_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.numpy'; Global = 'PYTHON_EN_CLAIR_NUMPY_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.matplotlib'; Global = 'PYTHON_EN_CLAIR_MATPLOTLIB_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.pandas'; Global = 'PYTHON_EN_CLAIR_PANDAS_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.scipy'; Global = 'PYTHON_EN_CLAIR_SCIPY_TRANSLATIONS'; Validate = $false },
    @{ File = 'traductions.seaborn'; Global = 'PYTHON_EN_CLAIR_SEABORN_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.sklearn'; Global = 'PYTHON_EN_CLAIR_SKLEARN_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.requests'; Global = 'PYTHON_EN_CLAIR_REQUESTS_TRANSLATIONS'; Validate = $false },
    @{ File = 'traductions.statsmodels'; Global = 'PYTHON_EN_CLAIR_STATSMODELS_TRANSLATIONS'; Validate = $true },
    @{ File = 'traductions.plotly'; Global = 'PYTHON_EN_CLAIR_PLOTLY_TRANSLATIONS'; Validate = $true }
)

foreach ($dictionary in $dictionaries) {
    $jsonPath = Join-Path $translationsDir ($dictionary.File + '.json')
    $dataPath = Join-Path $translationsDir ($dictionary.File + '-data.js')
    $json = [System.IO.File]::ReadAllText($jsonPath, [System.Text.Encoding]::UTF8)

    # PowerShell 5 confond certaines clés qui ne diffèrent que par leur casse
    # dans les dictionnaires SciPy et Requests. Le navigateur les valide ensuite.
    if ($dictionary.Validate) {
        $null = $json | ConvertFrom-Json
    }

    $javascript = 'window.' + $dictionary.Global + ' = ' + $json + ";`r`n"
    [System.IO.File]::WriteAllText($dataPath, $javascript, $utf8WithoutBom)
}

Write-Output 'Traductions synchronisées.'

