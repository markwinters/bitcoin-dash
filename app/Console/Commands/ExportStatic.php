<?php

namespace App\Console\Commands;

use App\Http\Controllers\DashboardController;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

class ExportStatic extends Command
{
    protected $signature = 'bitcoin:export-static {path=build : Doelmap voor de statische site}';

    protected $description = 'Exporteer het dashboard als statische site (bijv. voor GitHub Pages)';

    public function handle(): int
    {
        $target = base_path($this->argument('path'));

        File::ensureDirectoryExists($target);
        File::cleanDirectory($target);

        File::put("$target/index.html", view('dashboard', DashboardController::viewData(null, static: true))->render());
        File::put("$target/.nojekyll", '');

        foreach (['css/dashboard.css', 'js/dashboard.js', 'js/static-api.js', 'favicon.ico', 'robots.txt'] as $file) {
            if (File::exists(public_path($file))) {
                File::ensureDirectoryExists(dirname("$target/$file"));
                File::copy(public_path($file), "$target/$file");
            }
        }

        $this->components->info("Statische site geëxporteerd naar [$target].");

        return self::SUCCESS;
    }
}
