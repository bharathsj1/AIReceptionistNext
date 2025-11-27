import React from 'react';
import styles from './Hero.module.css';

export default function Hero() {
  const chatLines = [
    'Hi there! I see you’re calling about scheduling.',
    'Absolutely—I can book that for you now.',
    'Does tomorrow at 3 PM work for you?',
    'Great, you’re all set. Anything else you need?',
  ];

  return (
    <section className={styles.hero} id="home">
      <div className={styles.cloud} />
      <div className={styles.heroInner}>
        <div className="space-y-3">
          <div className={styles.badge}>
            <span aria-hidden>🔒</span>
            <span>HIPAA Compliant AI Receptionist</span>
          </div>
          <h1 className={styles.heading}>
            Never Miss a Call. Never <em>Lose</em> a Client with Our AI Assistants
          </h1>
          <p className={styles.lead}>
            Our AI assistants instantly answer calls, schedule appointments, reduce missed leads, and maximize your
            client retention effortlessly.
          </p>
          <div className={styles.ctaRow}>
            <a className={styles.ctaPrimary} href="#contact">
              Start Free Trial →
            </a>
            <a className={styles.ctaSecondary} href="#packages">
              Book a Demo
            </a>
          </div>
        </div>

        <div className={styles.scene} aria-hidden>
          <div className={styles.glass}>
            <div className={styles.mic}>
              <div className={styles.micIcon} />
              <div className={styles.waves}>
                <span className={styles.waveLine} />
                <span className={styles.waveLine} />
                <span className={styles.waveLine} />
              </div>
            </div>
            <div className={styles.nowPlaying}>
              <div className={styles.callName}>Black Marvin</div>
              <div className={styles.callTime}>4:38</div>
            </div>

            <div className={`${styles.badgeCall} ${styles.left}`}>
              <div className={styles.avatar}>
                <div className={styles.avatarHair} />
                <div className={styles.avatarFace} />
              </div>
              <div className={styles.callText}>
                <span className={styles.callLabel}>Mobile</span>
                <span className={styles.callSub}>Veres Panna</span>
                <div className={styles.callIcons}>
                  <span className={`${styles.icon} ${styles.call}`}>📞</span>
                  <span className={`${styles.icon} ${styles.video}`}>🎥</span>
                  <span className={`${styles.icon} ${styles.mute}`}>🔇</span>
                </div>
              </div>
            </div>

            <div className={styles.chatStream}>
              {chatLines.map((line) => (
                <div key={line} className={styles.chatLine}>
                  {line}
                </div>
              ))}
            </div>

            <div className={`${styles.badgeCall} ${styles.right}`}>
              <div className={styles.avatar}>
                <div className={styles.avatarHair} />
                <div className={styles.avatarFace} />
              </div>
              <div className={styles.callText}>
                <span className={styles.callLabel}>Mobile</span>
                <span className={styles.callSub}>Veres Panna</span>
                <div className={styles.callIcons}>
                  <span className={`${styles.icon} ${styles.call}`}>📞</span>
                  <span className={`${styles.icon} ${styles.video}`}>🎥</span>
                  <span className={`${styles.icon} ${styles.mute}`}>🔇</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
