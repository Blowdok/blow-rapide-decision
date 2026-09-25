import { describe, expect, it, vi } from 'vitest';
import { configurerTrousseauLinux } from '../../src/main/trousseau-linux';

describe('sélection du trousseau Linux', () => {
  it('choisit Secret Service sous Hyprland', () => {
    const ajouterSwitch = vi.fn();

    configurerTrousseauLinux({
      platform: 'linux',
      xdgCurrentDesktop: 'Hyprland',
      ajouterSwitch
    });

    expect(ajouterSwitch).toHaveBeenCalledWith('password-store', 'gnome-libsecret');
  });

  it('laisse Electron choisir le trousseau des autres environnements', () => {
    const ajouterSwitch = vi.fn();

    configurerTrousseauLinux({
      platform: 'linux',
      xdgCurrentDesktop: 'GNOME',
      ajouterSwitch
    });

    expect(ajouterSwitch).not.toHaveBeenCalled();
  });

  it('ne change pas le lancement hors Linux', () => {
    const ajouterSwitch = vi.fn();

    configurerTrousseauLinux({
      platform: 'win32',
      xdgCurrentDesktop: 'Hyprland',
      ajouterSwitch
    });

    expect(ajouterSwitch).not.toHaveBeenCalled();
  });
});
