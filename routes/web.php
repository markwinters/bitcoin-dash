<?php

use App\Http\Controllers\DashboardController;
use Illuminate\Support\Facades\Route;

Route::get('/', [DashboardController::class, 'index'])->name('dashboard');

Route::prefix('api/bitcoin')->middleware('throttle:120,1')->group(function () {
    Route::get('/', [DashboardController::class, 'snapshot'])->name('bitcoin.snapshot');
    Route::get('/chart', [DashboardController::class, 'chart'])->name('bitcoin.chart');
});
