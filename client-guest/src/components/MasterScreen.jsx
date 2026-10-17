import Header from './Header.jsx';
import { api } from '../api.js';
import { localName } from '../i18n.js';
import { rem } from '../lib/rem.js';

// On a salon's page, between the basket and the time: who the visit is with.
// "Any available master" comes first — the most times to choose from — then
// each master who performs everything in the basket.
export default function MasterScreen(f) {
  const { T, lang, qualifiedMasters, chooseMaster, backToBasket } = f;

  return (
    <>
      <Header
        title={T.chooseMasterTitle}
        onBack={backToBasket}
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />
      <div className="scrollarea" style={{ flex: 1, overflowY: 'auto', padding: '6px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MasterOption
          title={T.anyMaster}
          subtitle={T.anyMasterHint}
          onSelect={() => chooseMaster('any')}
          avatar={<AnyAvatar />}
        />
        {qualifiedMasters.length === 0 && (
          <p style={{ margin: 0, fontSize: rem(13.5), color: 'var(--muted)' }}>{T.noMasterForBasket}</p>
        )}
        {qualifiedMasters.map((m) => {
          const name = localName(m, lang) || m.slug;
          return (
            <MasterOption
              key={m.id}
              title={name}
              onSelect={() => chooseMaster(m.id)}
              avatar={<MasterAvatar master={m} name={name} />}
            />
          );
        })}
      </div>
    </>
  );
}

function MasterOption({ title, subtitle, avatar, onSelect }) {
  return (
    <button
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        padding: 14,
        borderRadius: 16,
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        color: 'var(--ink)',
      }}
    >
      {avatar}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: rem(15), fontWeight: 500 }}>{title}</span>
        {subtitle && <span style={{ fontSize: rem(12.5), color: 'var(--muted)' }}>{subtitle}</span>}
      </span>
      <span aria-hidden="true" style={{ color: 'var(--muted)', fontSize: rem(18) }}>›</span>
    </button>
  );
}

const AVATAR = { width: 48, height: 48, borderRadius: '50%', flexShrink: 0 };

// The master's photo, or their initial on the page's colour.
export function MasterAvatar({ master, name, size = 48 }) {
  const style = { ...AVATAR, width: size, height: size };
  if (master.photoVersion) {
    return <img src={api.photoUrl(master.photoVersion, master.id)} alt="" style={{ ...style, objectFit: 'cover' }} />;
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sage-light)', color: 'var(--sage)', fontSize: rem(size / 2.6), fontWeight: 600 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function AnyAvatar() {
  return (
    <span
      aria-hidden="true"
      style={{ ...AVATAR, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sage)', color: 'var(--white)', fontSize: rem(20) }}
    >
      ✦
    </span>
  );
}
