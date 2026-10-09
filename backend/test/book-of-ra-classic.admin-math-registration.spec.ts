import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { CasinoModule } from '../src/casino/casino.module';
import { CASINO_GAME_IDS, CasinoGameRegistry } from '../src/casino/casino-game.registry';
import { GAME_CONFIG_SPECS } from '../src/casino/casino-config.defaults';
import { CLASSIC_V1 } from '../src/casino/games/book-of-ra-classic/classic.definition';
import { CLASSIC_ID } from '../src/casino/games/book-of-ra-classic/classic.engine';
import {
  ClassicMathAdapter,
  defaultClassicProfile,
} from '../src/casino/games/book-of-ra-classic/classic.math-adapter';
import { GameMathRegistry } from '../src/casino/platform/math-control/math-control.registry';
import {
  GAME_MATH_ADAPTERS,
  type GameMathAdapter,
} from '../src/casino/platform/math-control/math-control.types';

const CLASSIC_GAME_ID = 'book-of-ra-classic';
const CLASSIC_DEFAULT_PROFILE_ID = 'book-of-ra-classic.rtp50.v1';
const OTHER_DELUXE_GAME_ID = 'book-of-ra-deluxe';

/**
 * The math-control providers exactly as `CasinoModule` declares them.
 *
 * Reading the module's own metadata keeps the registration under test instead
 * of a stand-in list, while skipping every unrelated provider so this spec needs
 * no database, Redis or HTTP server. Nothing runs the generate, validate or
 * activate workflow.
 */
const moduleDeclaredMathProviders = (): any[] => {
  const declared = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CasinoModule) ?? []) as any[];
  const adapterList = declared.find(
    (provider) => provider !== null && typeof provider === 'object' && provider.provide === GAME_MATH_ADAPTERS,
  );
  if (!adapterList) throw new Error('CasinoModule does not declare GAME_MATH_ADAPTERS');
  const injected: unknown[] = adapterList.inject ?? [];
  return declared.filter(
    (provider) => provider === GameMathRegistry || provider === adapterList || injected.includes(provider),
  );
};

const buildMathRegistry = async () => {
  const moduleRef = await Test.createTestingModule({ providers: moduleDeclaredMathProviders() }).compile();
  return { moduleRef, registry: moduleRef.get(GameMathRegistry) };
};

describe('Book of Ra Classic admin math control registration (no database)', () => {
  it('registers the Classic adapter under the Classic gameId in the real module wiring', async () => {
    const declared = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CasinoModule) ?? []) as any[];
    const wiring = declared.find((provider) => provider?.provide === GAME_MATH_ADAPTERS) as { inject: unknown[] };
    expect(wiring.inject).toContain(ClassicMathAdapter);

    const { moduleRef, registry } = await buildMathRegistry();
    try {
      const adapters = moduleRef.get<GameMathAdapter[]>(GAME_MATH_ADAPTERS);
      const classic = adapters.find((adapter) => adapter.gameId === CLASSIC_GAME_ID);
      expect(classic).toBeInstanceOf(ClassicMathAdapter);
      expect(classic?.gameId).toBe(CLASSIC_ID);

      expect(registry.has(CLASSIC_GAME_ID)).toBe(true);
      expect(registry.gameIds()).toContain(CLASSIC_GAME_ID);
      expect(registry.adapter(CLASSIC_GAME_ID)).toBe(classic);
      expect(registry.adapter(CLASSIC_GAME_ID).gameId).toBe(CLASSIC_GAME_ID);
      await expect(registry.adapter(CLASSIC_GAME_ID).capabilities()).resolves.toMatchObject({
        gameId: CLASSIC_GAME_ID,
      });
    } finally {
      await moduleRef.close();
    }
  });

  it('never serves Classic mathematics from another game and has no Deluxe fallback', async () => {
    const { moduleRef, registry } = await buildMathRegistry();
    try {
      expect(registry.gameIds()).toContain('lucky-lady');
      expect(registry.adapter('lucky-lady').gameId).not.toBe(CLASSIC_GAME_ID);
      expect(registry.adapter(CLASSIC_GAME_ID)).not.toBe(registry.adapter('lucky-lady'));

      expect(registry.has(OTHER_DELUXE_GAME_ID)).toBe(false);
      let thrown: unknown;
      try {
        registry.adapter(OTHER_DELUXE_GAME_ID);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).getResponse()).toMatchObject({
        code: 'GAME_MATH_NOT_INTEGRATED',
      });
    } finally {
      await moduleRef.close();
    }
  });

  it('defaults Classic to book-of-ra-classic.rtp50.v1 and keeps the current gameId coherent', () => {
    expect(CLASSIC_ID).toBe(CLASSIC_GAME_ID);
    expect(CLASSIC_V1.gameId).toBe(CLASSIC_GAME_ID);
    expect(CLASSIC_V1.profileId).toBe(CLASSIC_DEFAULT_PROFILE_ID);

    const frozen = defaultClassicProfile();
    expect(frozen.id).toBe(CLASSIC_DEFAULT_PROFILE_ID);
    expect(frozen.payload.gameId).toBe(CLASSIC_GAME_ID);

    const spec = GAME_CONFIG_SPECS[CLASSIC_GAME_ID];
    expect(spec.gameId).toBe(CLASSIC_GAME_ID);
    expect(spec.rtpControl).toBe('PROFILE');
    const baseline = spec.baseline();
    expect(baseline.gameSpecific.profile).toBe(CLASSIC_DEFAULT_PROFILE_ID);
    expect(baseline.label).toBe(CLASSIC_V1.version);

    expect(CASINO_GAME_IDS).toContain(CLASSIC_GAME_ID);
    const entry = new CasinoGameRegistry().findById(CLASSIC_GAME_ID);
    expect(entry).toMatchObject({
      id: CLASSIC_GAME_ID,
      slug: CLASSIC_GAME_ID,
      gameVersion: CLASSIC_V1.version,
      route: '/casino/slots/book-of-ra-classic',
      stateful: true,
    });
  });
});
