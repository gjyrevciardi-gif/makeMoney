import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CasinoGameType, CasinoRoundStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { CasinoService } from './casino.service';
import { CASINO_CATEGORIES, CasinoCategory } from './casino-game.registry';
import { DiceService } from './games/dice/dice.service';
import { MinesService } from './games/mines/mines.service';
import { PlayDiceDto } from './games/dice/dice.dto';
import { CashoutMinesDto, RevealMinesDto, StartMinesDto } from './games/mines/mines.dto';
import { RouletteService } from './games/roulette/roulette.service';
import { PlayRouletteDto } from './games/roulette/roulette.dto';
import { BlackjackService } from './games/blackjack/blackjack.service';
import { BlackjackActionDto, StartBlackjackDto } from './games/blackjack/blackjack.dto';
import { CrashService } from './games/crash/crash.service';
import { CashoutCrashDto, StartCrashDto } from './games/crash/crash.dto';
import { PlinkoService } from './games/plinko/plinko.service';
import { PlayPlinkoDto } from './games/plinko/plinko.dto';
import { SlotsService } from './games/slots/slots.service';
import { SpinSlotDto } from './games/slots/slot.dto';
import { TumbleSlotsService } from './games/slots/tumble.service';
import { SpinTumbleDto } from './games/slots/tumble.dto';

class HistoryQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsEnum(CasinoGameType) gameType?: CasinoGameType;
  @IsOptional() @IsEnum(CasinoRoundStatus) status?: CasinoRoundStatus;
}

class RecentQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(10) limit = 6;
}

class GamesQuery {
  @IsOptional() @IsIn(CASINO_CATEGORIES) category?: CasinoCategory;
  @IsOptional() @IsIn(['true', 'false']) featured?: 'true' | 'false';
  @IsOptional() @IsString() @MaxLength(80) search?: string;
}

class GameIdParam {
  @IsString() @MaxLength(60) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) gameId!: string;
}

/** Ensures forged identity fields are rejected rather than silently ignored. */
class EmptyFavoriteBody {
  @IsOptional() @IsIn([]) _empty?: never;
}

class GameTypeParam {
  @IsEnum(CasinoGameType) gameType!: CasinoGameType;
}

/**
 * Player-facing casino API.
 *
 * Every route resolves the acting user from the verified access token. No
 * endpoint accepts a user id, a balance, a result, a multiplier, or a payout,
 * and global whitelist validation rejects requests that try to send them.
 */
@Controller('casino')
@UseGuards(AccessGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
export class CasinoController {
  constructor(
    private readonly casino: CasinoService,
    private readonly dice: DiceService,
    private readonly mines: MinesService,
    private readonly roulette: RouletteService,
    private readonly blackjack: BlackjackService,
    private readonly crash: CrashService,
    private readonly plinko: PlinkoService,
    private readonly slots: SlotsService,
    private readonly tumble: TumbleSlotsService,
    private readonly limits: RateLimitService,
  ) {}

  private async throttle(userId: string) {
    await this.limits.consume('casino', userId, RATE_LIMITS.casino);
  }

  @Get('games')
  games(@Query() query: GamesQuery) {
    return this.casino.games({
      category: query.category,
      featured: query.featured === undefined ? undefined : query.featured === 'true',
      search: query.search,
    });
  }

  @Get('games/:gameType/config')
  gameConfig(@Param() params: GameTypeParam) {
    return this.casino.gameConfig(params.gameType);
  }

  @Get('history')
  history(@Req() request: AuthenticatedRequest, @Query() query: HistoryQuery) {
    return this.casino.history(request.actor.id, query);
  }

  @Get('recent')
  recent(@Req() request: AuthenticatedRequest, @Query() query: RecentQuery) {
    return this.casino.recent(request.actor.id, query.limit);
  }

  @Get('favorites')
  favorites(@Req() request: AuthenticatedRequest) {
    return this.casino.favorites(request.actor.id);
  }

  @Post('games/:gameId/favorite')
  addFavorite(
    @Req() request: AuthenticatedRequest,
    @Param() params: GameIdParam,
    @Body() _body: EmptyFavoriteBody,
  ) {
    return this.casino.addFavorite(request.actor.id, params.gameId);
  }

  @Delete('games/:gameId/favorite')
  removeFavorite(
    @Req() request: AuthenticatedRequest,
    @Param() params: GameIdParam,
    @Body() _body: EmptyFavoriteBody,
  ) {
    return this.casino.removeFavorite(request.actor.id, params.gameId);
  }

  @Get('rounds/:roundId')
  round(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
  ) {
    return this.casino.round(request.actor.id, roundId);
  }

  @Get('rounds/:roundId/verification')
  verify(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
  ) {
    return this.casino.verify(request.actor.id, roundId);
  }

  @Post('dice/play')
  async playDice(@Req() request: AuthenticatedRequest, @Body() body: PlayDiceDto) {
    await this.throttle(request.actor.id);
    return this.dice.play(request.actor.id, body);
  }

  @Get('mines/active')
  activeMines(@Req() request: AuthenticatedRequest) {
    return this.mines.active(request.actor.id);
  }

  @Post('mines/start')
  async startMines(@Req() request: AuthenticatedRequest, @Body() body: StartMinesDto) {
    await this.throttle(request.actor.id);
    return this.mines.start(request.actor.id, body);
  }

  @Post('mines/:roundId/reveal')
  async revealMines(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() body: RevealMinesDto,
  ) {
    await this.throttle(request.actor.id);
    return this.mines.reveal(request.actor.id, roundId, body);
  }

  @Post('mines/:roundId/cashout')
  async cashoutMines(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() body: CashoutMinesDto,
  ) {
    await this.throttle(request.actor.id);
    return this.mines.cashout(request.actor.id, roundId, body);
  }

  @Post('roulette/play')
  async playRoulette(@Req() request: AuthenticatedRequest, @Body() body: PlayRouletteDto) {
    await this.throttle(request.actor.id);
    return this.roulette.play(request.actor.id, body);
  }

  @Get('blackjack/active')
  activeBlackjack(@Req() request: AuthenticatedRequest) {
    return this.blackjack.active(request.actor.id);
  }

  @Post('blackjack/start')
  async startBlackjack(@Req() request: AuthenticatedRequest, @Body() body: StartBlackjackDto) {
    await this.throttle(request.actor.id);
    return this.blackjack.start(request.actor.id, body);
  }

  @Post('blackjack/:roundId/hit')
  async hitBlackjack(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() body: BlackjackActionDto,
  ) {
    await this.throttle(request.actor.id);
    return this.blackjack.hit(request.actor.id, roundId, body);
  }

  @Post('blackjack/:roundId/stand')
  async standBlackjack(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() body: BlackjackActionDto,
  ) {
    await this.throttle(request.actor.id);
    return this.blackjack.stand(request.actor.id, roundId, body);
  }

  @Post('blackjack/:roundId/double')
  async doubleBlackjack(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() body: BlackjackActionDto,
  ) {
    await this.throttle(request.actor.id);
    return this.blackjack.double(request.actor.id, roundId, body);
  }

  @Get('crash/active')
  activeCrash(@Req() request: AuthenticatedRequest) {
    return this.crash.active(request.actor.id);
  }

  @Post('crash/start')
  async startCrash(@Req() request: AuthenticatedRequest, @Body() body: StartCrashDto) {
    await this.throttle(request.actor.id);
    return this.crash.start(request.actor.id, body);
  }

  @Post('crash/:roundId/cashout')
  async cashoutCrash(
    @Req() request: AuthenticatedRequest,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() body: CashoutCrashDto,
  ) {
    await this.throttle(request.actor.id);
    return this.crash.cashout(request.actor.id, roundId, body);
  }

  @Post('plinko/play')
  async playPlinko(@Req() request: AuthenticatedRequest, @Body() body: PlayPlinkoDto) {
    await this.throttle(request.actor.id);
    return this.plinko.play(request.actor.id, body);
  }

  @Get('slots/:gameId/config')
  slotConfig(@Param() params: GameIdParam) {
    return this.slots.gameConfig(params.gameId);
  }

  @Post('slots/:gameId/spin')
  async spinSlot(
    @Req() request: AuthenticatedRequest,
    @Param() params: GameIdParam,
    @Body() body: SpinSlotDto,
  ) {
    await this.throttle(request.actor.id);
    return this.slots.spin(request.actor.id, params.gameId, body);
  }

  // The tumbling slots are a separate family with their own board, feature and
  // spin contract, so they get their own routes rather than overloading the
  // payline ones with a shape half of them cannot answer.
  @Get('tumble/:gameId/config')
  tumbleConfig(@Param() params: GameIdParam) {
    return this.tumble.gameConfig(params.gameId);
  }

  @Post('tumble/:gameId/spin')
  async spinTumble(
    @Req() request: AuthenticatedRequest,
    @Param() params: GameIdParam,
    @Body() body: SpinTumbleDto,
  ) {
    await this.throttle(request.actor.id);
    return this.tumble.spin(request.actor.id, params.gameId, body);
  }
}
