import { useBookingFlow } from './useBookingFlow.js';
import LandingScreen from './components/LandingScreen.jsx';
import ServicesScreen from './components/ServicesScreen.jsx';
import CalendarScreen from './components/CalendarScreen.jsx';
import DetailsScreen from './components/DetailsScreen.jsx';
import ConfirmationScreen from './components/ConfirmationScreen.jsx';
import LookupScreen from './components/LookupScreen.jsx';
import BookingsListScreen from './components/BookingsListScreen.jsx';
import ManageScreen from './components/ManageScreen.jsx';
import ReschedulePickerScreen from './components/ReschedulePickerScreen.jsx';
import CancelConfirmScreen from './components/CancelConfirmScreen.jsx';
import CancelledScreen from './components/CancelledScreen.jsx';

const SCREENS = {
  landing: LandingScreen,
  services: ServicesScreen,
  calendar: CalendarScreen,
  details: DetailsScreen,
  confirmation: ConfirmationScreen,
  lookup: LookupScreen,
  bookingsList: BookingsListScreen,
  manage: ManageScreen,
  reschedulePicker: ReschedulePickerScreen,
  cancelConfirm: CancelConfirmScreen,
  cancelled: CancelledScreen,
};

export default function App() {
  const flow = useBookingFlow();
  const Screen = SCREENS[flow.step] ?? LandingScreen;

  // No master lives at this address (a mistyped or deleted subdomain).
  if (flow.site?.missing) {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <p style={{ fontSize: 16, color: 'var(--muted)', textAlign: 'center' }}>{flow.T.pageNotFound}</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Screen {...flow} />
    </div>
  );
}
