<?php

namespace App\Http\Controllers;

use App\Services\BitcoinDataService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function __construct(private BitcoinDataService $bitcoin) {}

    public function index(): View
    {
        return view('dashboard', self::viewData($this->bitcoin->snapshot()));
    }

    /**
     * Viewdata voor het dashboard. Met $static worden assets relatief gelinkt en
     * haalt de browser alle data zelf op (statische GitHub Pages-build).
     */
    public static function viewData(?array $snapshot, bool $static = false): array
    {
        return [
            'snapshot' => $snapshot,
            'static' => $static,
            'ranges' => array_keys(BitcoinDataService::RANGES),
            'asset' => fn (string $path) => ($static ? $path : asset($path)).'?v='.filemtime(public_path($path)),
        ];
    }

    public function snapshot(): JsonResponse
    {
        return response()->json($this->bitcoin->snapshot())
            ->header('Cache-Control', 'public, max-age=15');
    }

    public function chart(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'range' => ['sometimes', 'in:'.implode(',', array_keys(BitcoinDataService::RANGES))],
            'currency' => ['sometimes', 'in:'.implode(',', config('bitcoin.currencies'))],
        ]);

        $range = $validated['range'] ?? '1d';
        $currency = $validated['currency'] ?? 'usd';
        $candles = $this->bitcoin->chart($range, $currency);

        return response()->json([
            'range' => $range,
            'currency' => $currency,
            'source' => 'Coinbase Exchange',
            'candles' => $candles ?? [],
        ], $candles === null ? 503 : 200)->header('Cache-Control', 'public, max-age=30');
    }
}
