# 桌面宠物素材处理：将纯白背景的 AI 素材图去除背景为透明 PNG
# 用法： powershell -ExecutionPolicy Bypass -File scripts/make-pet-assets.ps1
# 输出： src/assets/pet/{idle,happy,sad}.png
#
# 算法：以图像边缘采样色为基准色，用 8-连通 flood fill 从边界向内标记
#       "近白低饱和" 的背景区域并置为透明；角色内部近白的奶色高光由于
#       不与背景连通，不会被误挖洞。背景与毛缘过渡带做 alpha 渐变柔边。

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$candidateDir = Join-Path $root "src\assets\candidates"
$petDir = Join-Path $root "src\assets\pet"

New-Item -ItemType Directory -Force -Path $petDir | Out-Null

# 表情名 -> 候选文件名（candidates 目录内）
$mapping = [ordered]@{
  idle  = "Cute_chubby_cartoon_baby_bull__2026-09-05T08-26-17.png"
  happy = "Same_golden_fluffy_baby_bull_c_2026-09-05T08-28-06.png"
  sad   = "Same_golden_fluffy_baby_bull_c_2026-09-05T08-28-08.png"
}

Add-Type -AssemblyName System.Drawing

$cs = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class BgRemover
{
    public static void Remove(string inPath, string outPath)
    {
        using (var src = new Bitmap(inPath))
        {
            var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.DrawImage(src, 0, 0, src.Width, src.Height);
            }
            var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
            var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int bpp = 4;
            int bytes = Math.Abs(data.Stride) * bmp.Height;
            byte[] pixels = new byte[bytes];
            Marshal.Copy(data.Scan0, pixels, 0, bytes);
            int stride = data.Stride;
            int w = bmp.Width, h = bmp.Height;

            // 背景色 = 四周边框采样平均
            double sr = 0, sg = 0, sb = 0; int n = 0;
            Action<int, int> sample = (x, y) =>
            {
                if (x < 0 || x >= w || y < 0 || y >= h) return;
                int idx = y * stride + x * bpp;
                sr += pixels[idx + 2]; sg += pixels[idx + 1]; sb += pixels[idx];
                n++;
            };
            int m = Math.Min(w, h) / 10;
            for (int i = 0; i < m; i++)
            {
                for (int x = 0; x < w; x += 2) { sample(x, i); sample(x, h - 1 - i); }
                for (int y = 0; y < h; y += 2) { sample(i, y); sample(w - 1 - i, y); }
            }
            double br = sr / n, bg = sg / n, bb = sb / n;

            // solid-white 判断：低饱和且距背景色近
            Func<int, int, double> distBg = (x, y) =>
            {
                int idx = y * stride + x * bpp;
                double r = pixels[idx + 2], g = pixels[idx + 1], b = pixels[idx];
                double d = (r - br) * (r - br) + (g - bg) * (g - bg) + (b - bb) * (b - bb);
                return Math.Sqrt(d);
            };
            Func<int, int, bool> whiteish = (x, y) =>
            {
                int idx = y * stride + x * bpp;
                byte r = pixels[idx + 2], g = pixels[idx + 1], b = pixels[idx];
                int mn = Math.Min(Math.Min(r, g), b);
                int mx = Math.Max(Math.Max(r, g), b);
                bool lowSat = (mx - mn) <= 34;
                bool nearBg = Math.Sqrt(Math.Pow(r - br, 2) + Math.Pow(g - bg, 2) + Math.Pow(b - bb, 2)) <= 82;
                return lowSat && nearBg;
            };

            bool[] bgMark = new bool[w * h];
            var queue = new Queue<int>();
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    if (x == 0 || y == 0 || x == w - 1 || y == h - 1)
                    {
                        int p = y * w + x;
                        if (!bgMark[p] && whiteish(x, y)) { bgMark[p] = true; queue.Enqueue(p); }
                    }
                }
            }
            int[] dx = { 1, -1, 0, 0, 1, 1, -1, -1 };
            int[] dy = { 0, 0, 1, -1, 1, -1, 1, -1 };
            while (queue.Count > 0)
            {
                int p = queue.Dequeue();
                int px = p % w, py = p / w;
                for (int k = 0; k < 8; k++)
                {
                    int nx = px + dx[k], ny = py + dy[k];
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    int np = ny * w + nx;
                    if (!bgMark[np] && whiteish(nx, ny)) { bgMark[np] = true; queue.Enqueue(np); }
                }
            }

            // 写 alpha：背景连通区 -> 0；邻接背景的过渡像素 -> 渐变；其余保持
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    int p = y * w + x;
                    int idx = y * stride + x * bpp;
                    if (bgMark[p]) { pixels[idx + 3] = 0; continue; }
                    // 邻接背景的浅色过渡像素做柔边
                    bool nextToBg = false;
                    for (int k = 0; k < 8 && !nextToBg; k++)
                    {
                        int nx = x + dx[k], ny = y + dy[k];
                        if (nx >= 0 && ny >= 0 && nx < w && ny < h && bgMark[ny * w + nx]) nextToBg = true;
                    }
                    if (nextToBg)
                    {
                        byte r = pixels[idx + 2], g = pixels[idx + 1], b = pixels[idx];
                        int mn = Math.Min(Math.Min(r, g), b);
                        int mx = Math.Max(Math.Max(r, g), b);
                        double sat = mx - mn;
                        double d = distBg(x, y);
                        if (sat <= 40 && d <= 150)
                        {
                            double a = (d - 82) / 68.0;
                            if (a < 0) a = 0; if (a > 1) a = 1;
                            pixels[idx + 3] = (byte)(a * 255);
                        }
                    }
                }
            }

            Marshal.Copy(pixels, 0, data.Scan0, bytes);
            bmp.UnlockBits(data);
            bmp.Save(outPath, ImageFormat.Png);
            bmp.Dispose();
        }
    }
}
'@

Add-Type -TypeDefinition $cs -Language CSharp -ReferencedAssemblies "System.Drawing"

foreach ($entry in $mapping.GetEnumerator())
{
  $srcFile = Join-Path $candidateDir $entry.Value
  if (-not (Test-Path $srcFile)) { throw "缺少素材源文件: $srcFile" }
  $outFile = Join-Path $petDir ($entry.Key + ".png")
  [BgRemover]::Remove($srcFile, $outFile)
  $size = (Get-Item $outFile).Length
  Write-Output ("{0}  <-  {1}   ({2} KB)" -f $outFile, $entry.Value, [math]::Round($size / 1KB, 1))
}

Write-Output "完成：透明素材已输出到 src/assets/pet/"
