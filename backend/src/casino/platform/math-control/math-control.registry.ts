import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GAME_MATH_ADAPTERS, type GameMathAdapter } from './math-control.types';

/**
 * The per-game mathematics adapters, injected as one list.
 *
 * The control plane never imports a game: adding a game means adding one entry
 * to the module's provider list. Asking for a game that is not integrated is a
 * 404, never a silent fallback to another game's mathematics.
 */
@Injectable()
export class GameMathRegistry {
  private readonly byGameId: Map<string, GameMathAdapter>;

  constructor(@Inject(GAME_MATH_ADAPTERS) adapters: GameMathAdapter[]) {
    this.byGameId = new Map(adapters.map((adapter) => [adapter.gameId, adapter]));
  }

  has(gameId: string): boolean {
    return this.byGameId.has(gameId);
  }

  gameIds(): string[] {
    return [...this.byGameId.keys()].sort();
  }

  adapter(gameId: string): GameMathAdapter {
    const adapter = this.byGameId.get(gameId);
    if (!adapter) {
      throw new NotFoundException({ code: 'GAME_MATH_NOT_INTEGRATED', message: `No mathematics adapter for ${gameId}.` });
    }
    return adapter;
  }
}
