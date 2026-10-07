import Header from './Header.jsx';
import SlotPicker from './SlotPicker.jsx';
import ErrorBanner from './ErrorBanner.jsx';

export default function ReschedulePickerScreen(f) {
  const { T, lang } = f;
  const errorText = f.bannerErrorKey ? T[f.bannerErrorKey] : null;

  return (
    <>
      <Header
        title={T.chooseNewTime}
        onBack={f.backFromSubflow}
        lang={f.lang}
        langMenuOpen={f.langMenuOpen}
        toggleLangMenu={f.toggleLangMenu}
        setLang={f.setLang}
      />

      <ErrorBanner text={errorText} />

      <SlotPicker
        T={T}
        lang={lang}
        slotsData={f.slotsData}
        slotsLoading={f.slotsLoading}
        selectedDayIndex={f.selectedDayIndex}
        selectedSlot={f.selectedSlot}
        selectDay={f.selectDay}
        selectSlot={f.selectSlot}
      />

      {f.selectedSlot && (
        <div style={{ padding: '14px 24px 20px', borderTop: '1px solid var(--line)', background: 'var(--surface)' }}>
          <button
            onClick={f.confirmNewTime}
            disabled={f.busy}
            style={{ width: '100%', padding: 16, borderRadius: 999, background: 'var(--sage)', color: 'var(--white)', fontSize: 15, fontWeight: 600, opacity: f.busy ? 0.7 : 1 }}
          >
            {T.confirmNewTime}
          </button>
        </div>
      )}
    </>
  );
}
