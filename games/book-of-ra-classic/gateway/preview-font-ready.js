Promise.all(window.WebFontConfig.google.families.map(f=>document.fonts.load('16px "'+f+'"'))).then(()=>document.fonts.ready).then(()=>window.WebFontConfig.active());
