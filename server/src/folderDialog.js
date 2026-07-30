import { execFile } from 'node:child_process';
import { platform } from 'node:os';

// Native "choose a folder" dialog, invoked from the settings UI so the
// user can point at a NAS share (already mounted by the OS) without
// typing an absolute path by hand. Only makes sense when the browser
// tab and this server are on the same machine — which is the normal
// setup here (the Sala PC is also the server). Returns the chosen
// absolute path, or null if the user cancelled.
export function browseForFolder() {
  const os = platform();

  if (os === 'darwin') {
    return runDialog('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Elegí la carpeta de canciones")',
    ]);
  }

  if (os === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$dialog.Description = "Elegí la carpeta de canciones"',
      'if ($dialog.ShowDialog() -eq "OK") { Write-Output $dialog.SelectedPath }',
    ].join('; ');
    return runDialog('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  }

  // Linux: try zenity first (GNOME/most distros), fall back to kdialog (KDE).
  return runDialog('zenity', ['--file-selection', '--directory', '--title=Elegí la carpeta de canciones'])
    .catch(() => runDialog('kdialog', ['--getexistingdirectory', '.']));
}

function runDialog(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5 * 60 * 1000 }, (err, stdout) => {
      if (err) {
        // Non-zero exit is how these tools report "user cancelled" — not
        // a real failure, so resolve to null instead of rejecting, except
        // when the command itself doesn't exist (ENOENT) so the Linux
        // zenity->kdialog fallback above can kick in.
        if (err.code === 'ENOENT') return reject(err);
        return resolve(null);
      }
      const path = stdout.trim();
      resolve(path || null);
    });
  });
}
