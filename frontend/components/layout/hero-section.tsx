'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Tag, Wrench, Pause, Play, MapPin } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/contexts/i18n-context';

type MessagePhase = 'typing' | 'message' | 'leaving' | 'gap';
const phaseDuration: Record<MessagePhase, number> = { typing: 1400, message: 3600, leaving: 280, gap: 180 };
const nextPhase: Record<MessagePhase, MessagePhase> = { typing: 'message', message: 'leaving', leaving: 'gap', gap: 'typing' };

export function HeroSection() {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState<{ index: number; phase: MessagePhase }>({ index: 0, phase: 'typing' });
  const [hidden, setHidden] = useState(false);
  const stopMotion = reduceMotion || paused || hidden;
  useEffect(() => {
    const syncVisibility = () => setHidden(document.hidden);
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);
  useEffect(() => {
    if (stopMotion) return;
    const timeout = setTimeout(() => {
      setCycle(previous => ({
        index: previous.phase === 'gap' ? (previous.index + 1) % 4 : previous.index,
        phase: nextPhase[previous.phase],
      }));
    }, phaseDuration[cycle.phase]);
    return () => clearTimeout(timeout);
  }, [stopMotion, cycle]);
  const examples = [
    { place: t('modern.demo.plaka', 'Plaka'), title: t('modern.demo.guitar', 'Acoustic guitar'), price: '85 €' },
    { place: t('modern.demo.koukaki', 'Koukaki'), title: t('modern.demo.yoga', 'Yoga in the neighborhood'), price: '15 €' },
    { place: t('modern.demo.pangrati', 'Pangrati'), title: t('modern.demo.bike', 'A bicycle for the city'), price: '120 €' },
    { place: t('modern.demo.thiseio', 'Thiseio'), title: t('modern.demo.plants', 'Plants looking for a home'), price: t('modern.demo.free', 'Free') },
  ];
  const example = examples[cycle.index];
  const phase = reduceMotion ? 'message' : cycle.phase;
  const phrases = [t('modern.hero.title'), t('modern.hero.sell', 'Give things a new life.'), t('modern.hero.help', 'Share what you can do.'), t('modern.hero.title')];
  function search(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    router.push('/search' + (params.size ? '?' + params : ''));
  }
  return <section className="needs-city-hero" aria-labelledby="home-title">
    <Image src="/athens.jpg" alt={t('modern.hero.imageAlt', 'Athens, the Acropolis and the sea')} fill preload sizes="100vw" className="needs-city-image object-cover" />
    <div className="needs-city-shade" />
    <div className="needs-city-examples" aria-hidden="true" data-paused={Boolean(stopMotion)} data-reduced-motion={Boolean(reduceMotion)}>
      {phase !== 'gap' && <div key={cycle.index} className={'needs-city-example needs-city-example-' + cycle.index} data-phase={phase}>
        <motion.div className={'needs-city-bubble' + (phase === 'typing' ? ' is-typing' : '')}
          initial={reduceMotion ? false : { opacity: 0, y: 8, scale: .96 }}
          animate={phase === 'leaving' ? { opacity: 0, y: -6, scale: .98 } : { opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : .28, ease: 'easeOut' }}>
          {phase === 'typing' ? <span className="needs-city-typing"><i /><i /><i /></span> :
            <div className="needs-city-message">
              <div className="needs-city-message-meta"><span><MapPin size={12} />{example.place}</span><span>{example.price}</span></div>
              <p>{example.title}</p>
            </div>}
        </motion.div>
      </div>}
    </div>
    <div className="needs-city-copy">
      <h1 id="home-title" className="sr-only">{t('modern.hero.title')} {t('modern.hero.accent')}</h1>
      <div className="needs-city-heading" aria-hidden="true"><div className="needs-city-phrase"><AnimatePresence mode="wait" initial={false}>
        <motion.span key={reduceMotion ? 'static' : cycle.index} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: reduceMotion ? 0 : .3 }}>{reduceMotion ? phrases[0] : phrases[cycle.index]}</motion.span>
      </AnimatePresence></div><span className="needs-city-accent">{t('modern.hero.accent')}</span></div>
      <p>{t('modern.hero.description', 'Items and services from people around you.')}</p>
    </div>
    <div className="needs-city-search">
      <form onSubmit={search} role="search" className="needs-hero-search">
        <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
        <label className="sr-only" htmlFor="home-search">{t('search.inputPlaceholder', 'What are you looking for?')}</label>
        <input id="home-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder={t('search.inputPlaceholder', 'What are you looking for?')} maxLength={200} />
        <Button type="submit">{t('search.header', 'Search')}</Button>
      </form>
      <div className="needs-hero-categories">
        <Link href="/items"><Tag aria-hidden="true" className="h-5 w-5" />{t('navbar.items', 'Items')}</Link>
        <Link href="/services"><Wrench aria-hidden="true" className="h-5 w-5" />{t('navbar.services', 'Services')}</Link>
      </div>
    </div>
    <div className="needs-city-caption"><span>{t('modern.demo.caption', 'Illustrative listings around Athens')}</span>
      {!reduceMotion && <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)} aria-label={paused ? t('modern.demo.play', 'Play animations') : t('modern.demo.pause', 'Pause animations')}>
        {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
      </button>}
    </div>
  </section>;
}
