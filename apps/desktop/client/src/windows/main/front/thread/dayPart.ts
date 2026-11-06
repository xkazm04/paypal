// The hello follows the clock: the part of the day re-read every minute and on a preview clock jump
// (lib/clock.ts), instead of once at mount.
import { useEffect, useState } from 'react';
import { clockNow, onClockChange } from '../../../../lib/clock';
import { partOfDay, type DayPart } from './greeting';

export function useDayPart(): DayPart {
  const [part, setPart] = useState<DayPart>(() => partOfDay(clockNow() * 1000));
  useEffect(() => {
    const read = () => setPart(partOfDay(clockNow() * 1000));
    read();
    const timer = setInterval(read, 60_000);
    const off = onClockChange(read);
    return () => { clearInterval(timer); off(); };
  }, []);
  return part;
}
