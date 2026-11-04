'use strict';

/* Gallery lightbox: turns any .gallery-grid media grid into a
clickable full-screen carousel. Auto-discovers img/video children,
so album pages need no per-page configuration. Include this script
on any page that has a .gallery-grid. */

(function () {

	function init() {

		var grid = document.querySelector('#main .gallery-grid');
		if (!grid) return;

		var items = [];
		Array.prototype.forEach.call(grid.children, function (el) {

			if (el.tagName === 'IMG') {
				items.push({ type: 'img', src: el.currentSrc || el.src, alt: el.alt || '', poster: '' });
			}
			else if (el.tagName === 'VIDEO') {
				var srcEl = el.querySelector('source');
				items.push({ type: 'video', src: el.src || (srcEl ? srcEl.src : ''), alt: el.getAttribute('aria-label') || '', poster: el.poster || '' });
			}

		});
		if (!items.length) return;

		var overlay = null;
		var stage = null;
		var counter = null;
		var index = 0;
		var lastFocus = null;
		var keyHandler = null;

		function build() {

			overlay = document.createElement('div');
			overlay.className = 'lightbox';
			overlay.setAttribute('role', 'dialog');
			overlay.setAttribute('aria-modal', 'true');
			overlay.innerHTML =
				'<button class="lightbox-close" type="button" aria-label="Close">&#10005;</button>' +
				'<button class="lightbox-prev" type="button" aria-label="Previous image">&#8249;</button>' +
				'<button class="lightbox-next" type="button" aria-label="Next image">&#8250;</button>' +
				'<div class="lightbox-stage"></div>' +
				'<div class="lightbox-counter"></div>';
			document.body.appendChild(overlay);

			stage = overlay.querySelector('.lightbox-stage');
			counter = overlay.querySelector('.lightbox-counter');

			overlay.querySelector('.lightbox-close').addEventListener('click', close);
			overlay.querySelector('.lightbox-prev').addEventListener('click', function () { show(index - 1); });
			overlay.querySelector('.lightbox-next').addEventListener('click', function () { show(index + 1); });

			// Click on the backdrop (not the media or controls) closes.
			overlay.addEventListener('click', function (e) {
				if (e.target === overlay) close();
			});

			// Touch swipe: left opens next, right opens previous.
			var startX = null;
			overlay.addEventListener('touchstart', function (e) {
				startX = e.touches[0].clientX;
			}, { passive: true });
			overlay.addEventListener('touchend', function (e) {
				if (startX === null) return;
				var dx = e.changedTouches[0].clientX - startX;
				if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
				startX = null;
			}, { passive: true });

			keyHandler = function (e) {
				if (e.key === 'Escape') { close(); }
				else if (e.key === 'ArrowRight') { show(index + 1); }
				else if (e.key === 'ArrowLeft') { show(index - 1); }
			};
			document.addEventListener('keydown', keyHandler);

		}

		function show(i) {

			// Wrap around both ends so it behaves like a carousel.
			index = (i + items.length) % items.length;
			var it = items[index];

			stage.innerHTML = '';
			var media;

			if (it.type === 'img') {
				media = new Image();
				media.src = it.src;
				media.alt = it.alt;
				media.decoding = 'async';
			}
			else {
				media = document.createElement('video');
				media.src = it.src;
				media.controls = true;
				media.autoplay = true;
				media.playsInline = true;
				if (it.poster) media.poster = it.poster;
			}

			stage.appendChild(media);

			counter.textContent = (index + 1) + ' / ' + items.length;

			// Preload the neighbors so next/previous feels instant.
			[items[(index + 1) % items.length], items[(index - 1 + items.length) % items.length]]
				.forEach(function (n) {
					if (n.type === 'img') {
						var pre = new Image();
						pre.src = n.src;
					}
				});

		}

		function open(i) {

			lastFocus = document.activeElement;
			build();
			show(i);

			// Lock the page behind the lightbox.
			document.documentElement.style.overflow = 'hidden';
			document.body.style.overflow = 'hidden';
			overlay.querySelector('.lightbox-close').focus();

		}

		function close() {

			if (!overlay) return;
			document.removeEventListener('keydown', keyHandler);
			overlay.remove();
			overlay = null;
			stage = null;
			counter = null;

			document.documentElement.style.overflow = '';
			document.body.style.overflow = '';
			if (lastFocus) lastFocus.focus();

		}

		Array.prototype.forEach.call(items, function (it, i) {
			grid.children[i].addEventListener('click', function () { open(i); });
		});

	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

})();
