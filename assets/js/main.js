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
 * Initial Page Animation
 *
 * Removes the preload class after the document loads. This drives the
 * homepage's load choreography: the is-preload CSS (site-shell.css and
 * homepage.css) holds the nav items and background faded out and the
 * content box collapsed, and removing the class lets all of it
 * transition into view.
 *
 * Only index.html ships <body class="is-preload">. Every other page is
 * intentionally static — it must NOT get a preload class — so this
 * block is a no-op there but still required by the homepage.
 */
    document.addEventListener('DOMContentLoaded', function () {

        window.setTimeout(function () {
            document.body.classList.remove('is-preload');
        }, 100);

    });

/*
* Navigation Alignment (homepage)
*
* When the homepage nav has an even number of links, a white 1px center
* divider (`nav.use-middle:after`) is drawn between the two column-halves
* and one link is marked .is-middle so its left border is suppressed.
* This is an intentional part of the homepage visual, not leftover
* template behavior — keep the CSS in homepage.css in sync if touched.
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
* History-Aware Back Links
*
* Page-back arrows return to the page the visitor came from when that
* page is on this site (real browser history). Otherwise the link's
* hardcoded href (the page's parent hub) is followed as the fallback,
* e.g. when the page was opened directly in a new tab.
*/
    document.addEventListener('click', function (event) {

        const back = event.target.closest('a.page-back');

        if (!back)
            return;

        if (!document.referrer)
            return;

        let from;

        try {
            from = new URL(document.referrer);
        } catch (e) {
            return;
        }

        if (from.origin !== window.location.origin)
            return;

        if (from.pathname === window.location.pathname)
            return;

        event.preventDefault();
        window.history.back();

    });

})();