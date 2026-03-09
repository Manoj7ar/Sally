// Screenshot service - captures screen via Electron desktopCapturer
import { desktopCapturer } from 'electron';

class ScreenshotService {
  async captureScreen(): Promise<string> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources || sources.length === 0) {
      throw new Error('No screen sources available for capture');
    }

    // Use the primary screen (first source)
    const primaryScreen = sources[0];
    const base64 = primaryScreen.thumbnail.toPNG().toString('base64');
    console.log('[Screenshot] Captured screen, PNG size:', base64.length, 'chars');
    return base64;
  }
}

export const screenshotService = new ScreenshotService();
