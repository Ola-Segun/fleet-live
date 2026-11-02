'use client';

import { useEffect, useRef, useState } from 'react';

/** Digits scramble and lock in left to right once, when scrolled into view. Static under reduced motion. */
export function SettleText({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [animation, setAnimation] = useState({ value, output: value });
  const out = animation.value === value ? animation.output : value;

  useEffect(() => {
    const el = ref.current;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!el || motionPreference.matches || !/\d/.test(value)) return;
    let timer = 0;
    const finish = () => {
      window.clearInterval(timer);
      setAnimation({ value, output: value });
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const steps = 16;
        let step = 0;
        timer = window.setInterval(() => {
          step += 1;
          const keep = Math.floor((step / steps) * value.length);
          setAnimation({
            value,
            output: value
              .split('')
              .map((character, index) =>
                index < keep || !/\d/.test(character) ? character : String(Math.floor(Math.random() * 10)),
              )
              .join(''),
          });
          if (step >= steps) {
            window.clearInterval(timer);
            setAnimation({ value, output: value });
          }
        }, 38);
      },
      { threshold: 0.6 },
    );
    const onMotionChange = () => {
      if (motionPreference.matches) finish();
    };
    motionPreference.addEventListener('change', onMotionChange);
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
      motionPreference.removeEventListener('change', onMotionChange);
    };
  }, [value]);

  return (
    <span ref={ref}>
      <span aria-hidden="true">{out}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
