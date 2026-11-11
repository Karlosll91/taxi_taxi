import { Game } from './game';

// Let the loading screen paint before the city is generated.
requestAnimationFrame(() =>
  setTimeout(() => {
    const game = new Game(document.querySelector<HTMLCanvasElement>('#game')!);
    // ?debug exposes the game object in the console for testing.
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { taxi: Game }).taxi = game;
    if (new URLSearchParams(location.search).has('debug')) import('three').then((T) => ((window as unknown as { THREE: unknown }).THREE = T));
  }, 30),
);
