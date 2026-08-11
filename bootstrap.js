const startupError = document.querySelector('#startup-error');

function showStartupError(message) {
  document.body.classList.add('visualization-unavailable');
  startupError.textContent = message;
  startupError.hidden = false;
}

function browserGraphicsCapabilities() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (!context) return { supported: false, reason: 'WebGL 2 is not available.' };
    const maximumTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE);
    const loseContext = context.getExtension('WEBGL_lose_context');
    if (loseContext) loseContext.loseContext();
    if (maximumTextureSize < 8192) {
      return {
        supported: false,
        reason: `This device supports textures up to ${maximumTextureSize}px, but the lunar map requires 8192px.`
      };
    }
    return { supported: true };
  } catch (error) {
    return { supported: false, reason: error.message };
  }
}

const capabilities = browserGraphicsCapabilities();
if (!capabilities.supported) {
  showStartupError(`${capabilities.reason} Try an up-to-date browser with hardware acceleration enabled.`);
} else {
  import('./main.js').catch((error) => {
    console.error('Visualization failed to start.', error);
    showStartupError('The visualization could not start. Check your browser settings and network connection, then reload the page.');
  });
}
