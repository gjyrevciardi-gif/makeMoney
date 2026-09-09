import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { SportsService } from './sports.service';
class OddsQuery { @IsString() @Matches(/^[a-z0-9_:-]{1,100}$/) sportKey!: string; }
@Controller('sports')
export class SportsController {
  constructor(private readonly sports: SportsService) {}
  @Get() list() { return this.sports.getSports(); }
  @Get(':sportKey/events') events(@Param('sportKey') sportKey: string) { return this.sports.getEvents(sportKey); }
  // Listing primitive for the sportsbook grid: events plus their primary markets.
  @Get(':sportKey/board') board(@Param('sportKey') sportKey: string) { return this.sports.getBoard(sportKey); }
  @Get('events/:eventId/odds') odds(@Param('eventId') eventId: string, @Query() query: OddsQuery) { return this.sports.getEventOdds(query.sportKey, eventId); }
}
