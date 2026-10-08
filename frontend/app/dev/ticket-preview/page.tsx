import { notFound } from 'next/navigation';
import { SettledTicket, type TicketBet } from '../../../components/sports/settled-ticket';

/**
 * Visual fixture for design review only.
 *
 * Renders the real ticket component with hard-coded sample data so the layout
 * can be compared against the reference without needing a settled bet. It does
 * not exist in production builds and never touches the API or a wallet.
 */
const sample: TicketBet = {
  id: 'preview',
  type: 'ACCUMULATOR',
  status: 'OPEN',
  stake: '1',
  totalOdds: '24.00',
  potentialPayout: '24',
  createdAt: '2026-02-15T20:19:00',
  legs: [
    { id: 'a', sportKey: 'soccer', homeTeam: 'Atlas', awayTeam: 'Puebla', marketName: 'Match Result', selectionName: 'Puebla', acceptedOdds: '4.00', status: 'LOST', eventStartTime: '2026-02-15T18:00:00' },
    { id: 'b', sportKey: 'soccer', homeTeam: 'Carabobo', awayTeam: 'Yaracuyanos', marketName: 'Match Result', selectionName: 'Draw', acceptedOdds: '3.60', status: 'WON', eventStartTime: '2026-02-15T16:45:00' },
    { id: 'c', sportKey: 'soccer', homeTeam: 'Atletico San Luis Women', awayTeam: 'Queretaro Women', marketName: 'Match Result', selectionName: 'Queretaro Women', acceptedOdds: '1.67', status: 'WON', eventStartTime: '2026-02-15T18:00:00' },
  ],
};

export default function TicketPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="ticket-preview">
      <SettledTicket bet={sample} />
    </main>
  );
}
