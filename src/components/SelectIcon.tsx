import lightIcon from '../../assets/menu/select-light.png';
import darkIcon from '../../assets/menu/select-dark.png';

export function SelectIcon({ theme }: { theme: 'light' | 'dark' }) {
  return <img className="tool-icon select-icon" style={{ width: 16, height: 16, minWidth: 16, objectFit: 'contain', verticalAlign: 'middle' }} src={theme === 'dark' ? darkIcon : lightIcon} alt="" aria-hidden="true" />;
}
