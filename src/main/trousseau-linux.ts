/** Sélectionne Secret Service quand Electron ne reconnaît pas le bureau Hyprland. */
export function configurerTrousseauLinux(options: {
  platform: string;
  xdgCurrentDesktop: string | undefined;
  ajouterSwitch: (nom: string, valeur: string) => void;
}): void {
  const bureaux = options.xdgCurrentDesktop?.split(':').map((bureau) => bureau.trim().toLowerCase()) ?? [];
  if (options.platform !== 'linux' || !bureaux.includes('hyprland')) return;

  options.ajouterSwitch('password-store', 'gnome-libsecret');
}