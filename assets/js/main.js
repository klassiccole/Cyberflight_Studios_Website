/*
	Cyberflight Studios
	Site-wide JavaScript

	Originally based on Dimension by HTML5 UP
	html5up.net | @ajlkn
	CCA 3.0 license: html5up.net/license

	The original Dimension single-page article navigation has been removed.
	Cyberflight Studios now uses a multi-page structure with dedicated URLs
	for improved navigation, maintainability, and search engine indexing.
*/

(function () {

	'use strict';

    /*
    * Responsive Breakpoints
    *
    * Retains optional breakpoint support for pages that load
    * the Dimension breakpoint library.
    */
        if (typeof breakpoints === 'function') {

            breakpoints({
                xlarge:  [ '1281px', '1680px' ],
                large:   [ '981px',  '1280px' ],
                medium:  [ '737px',  '980px' ],
                small:   [ '481px',  '736px' ],
                xsmall:  [ '361px',  '480px' ],
                xxsmall: [ null,     '360px' ]
            });

        }

/*
* Initial Page Animation
*
* Removes transition classes when a page is loaded or restored from
* browser history, allowing the page to fade smoothly into view.
*/
    document.addEventListener('DOMContentLoaded', function () {

        window.setTimeout(function () {
            document.body.classList.remove('is-preload');
            document.body.classList.remove('is-page-leaving');
        }, 100);

    });

/*
 * Browser History Restoration
 *
 * Browsers may restore a previous page from the back/forward cache rather
 * than loading it again. Remove the leaving state so restored pages become
 * visible again.
 */

    window.addEventListener('pageshow', function () {

        document.body.classList.remove('is-page-leaving');

    });


/*
* Navigation Alignment
*
* Preserves Dimension's centered navigation styling when the
* navigation contains an even number of menu items.
*/
	document.addEventListener('DOMContentLoaded', function () {

		const nav = document.querySelector('#header nav');

		if (!nav)
			return;

		const navItems = nav.querySelectorAll('li');

		if (navItems.length > 0 && navItems.length % 2 === 0) {

			nav.classList.add('use-middle');

			navItems[navItems.length / 2].classList.add('is-middle');

		}

	});

/*
* Standalone Page Home Button
*
* Automatically adds a Home button to the upper-right corner of
* standalone pages. This keeps navigation consistent without requiring
* the button to be manually added to every HTML file.
*/
    document.addEventListener('DOMContentLoaded', function () {

        if (!document.body.classList.contains('standalone-page'))
            return;

        const article = document.querySelector('#main article');

        if (!article)
            return;

        const homeButton = document.createElement('a');

        homeButton.href = '/';
        homeButton.className = 'page-home icon solid fa-home';
        homeButton.setAttribute('aria-label', 'Home');
        homeButton.setAttribute('title', 'Home');

        article.appendChild(homeButton);

    });

/*
* Standalone Page Back Navigation
*
* Makes the page Back arrow behave like the browser's Back button.
* This returns the visitor to the page they actually came from rather
* than always following the page's directory-based fallback link.
*/
	document.addEventListener('DOMContentLoaded', function () {

		const backButton = document.querySelector('.page-back');

		if (!backButton)
			return;

		backButton.addEventListener('click', function (event) {

			event.preventDefault();

			document.body.classList.add('is-page-leaving');

			window.setTimeout(function () {
				window.history.back();
			}, 400);

		});

	});

/*
* Page Transitions
*
* Fades the current page out before navigating to another internal
* Cyberflight Studios page. The destination page then fades in through
* the Initial Page Animation above.
*/
	document.addEventListener('DOMContentLoaded', function () {

		const internalLinks = document.querySelectorAll('a[href]');

		internalLinks.forEach(function (link) {

			link.addEventListener('click', function (event) {

				const href = link.getAttribute('href');

				// Ignore links that should not use page transitions.
				if (
					!href ||
					href.startsWith('#') ||
					href.startsWith('mailto:') ||
					href.startsWith('tel:') ||
                    link.classList.contains('page-back') ||
					link.target === '_blank'
				) {
					return;
				}

				const destination = new URL(link.href, window.location.href);

				// Only animate navigation within Cyberflight Studios.
				if (destination.origin !== window.location.origin)
					return;

				// Allow modifier keys to behave normally.
				if (
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey ||
					event.altKey
				) {
					return;
				}

				event.preventDefault();

				document.body.classList.add('is-page-leaving');

				window.setTimeout(function () {
					window.location.href = destination.href;
				}, 400);

			});

		});

	});

})();