import React from 'react';
import styles from './ReceptionistAnimation.module.css';

const messages = [
  'Hello, How can I help you?',
  'Great! I can set that up for you right now.',
  'Could you share the date and time that works best?',
  'Perfect, I\'ve secured that slot for you.',
  'Anything else you want me to note for the team?',
];

/**
 * ReceptionistAnimation
 * - Inline HTML/SVG-style shapes build the receptionist, desk, phone, and laptop.
 * - CSS keyframes (see ReceptionistAnimation.module.css) animate breathing, phone motion, screen glow, and speech cycling.
 */
export default function ReceptionistAnimation() {
  return (
    <div className={styles.wrapper}>
      <h2 className={styles.title}>AI Receptionist</h2>
      <div className={styles.scene}>
        <div className={styles.orbit} />
        <span className={`${styles.dot} ${styles.one}`} />
        <span className={`${styles.dot} ${styles.yellow} ${styles.two}`} />
        <span className={`${styles.dot} ${styles.pink} ${styles.three}`} />
        <span className={`${styles.dot} ${styles.four}`} />

        {/* Speech bubble with cycling text messages */}
        <div className={styles.bubble}>
          {messages.map((text) => (
            <span key={text} className={styles.message}>
              {text}
            </span>
          ))}
        </div>

        {/* Receptionist body group with breathing animation */}
        <div className={styles.avatar}>
          <div className={styles.head}>
            <div className={styles.hair} />
            <div className={styles.ear} />
            <div className={styles.headset}>
              <div className={styles.mic} />
            </div>
          </div>
          <div className={styles.body}>
            <div className={styles.collar} />
          </div>
        </div>

        {/* Laptop with glowing screen */}
        <div className={styles.laptop}>
          <div className={styles.screen} />
        </div>

        {/* Desk surface */}
        <div className={styles.desk} />

        {/* Soft shadow base */}
        <div className={styles.base} />
      </div>
      <p className={styles.subtitle}>Always ready to greet your customers.</p>
    </div>
  );
}
