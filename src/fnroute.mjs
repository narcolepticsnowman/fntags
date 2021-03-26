import { fnstate, getAttrs, h, isAttrs, renderNode } from './fntags.mjs'

/**
 * An element that is displayed only if the the current route starts with elements path attribute.
 *
 * For example,
 *  route({path: "/proc"},
 *      div(
 *          "proc",
 *          div({path: "/cpuinfo"},
 *              "cpuinfo"
 *              )
 *          )
 *      )
 *
 *  You can override this behavior by setting the attribute, absolute to any value
 *
 *  route({path: "/usr"},
 *      div(
 *          "proc",
 *          div({path: "/cpuinfo", absolute: true},
 *              "cpuinfo"
 *              )
 *          )
 *      )
 *
 * @param children The attributes and children of this element.
 * @returns HTMLDivElement
 */
export const route = ( ...children ) => {
    const attrs = getAttrs( children )
    children = children.filter( c => !isAttrs( c ) )
    const routeEl = h( 'div', attrs )
    const display = routeEl.style.display
    let path = routeEl.getAttribute( 'path' )
    if( !path ) {
        throw new Error( 'route must have a string path attribute' ).stack
    }
    routeEl.updateRoute = () => {
        while( routeEl.firstChild ) {
            routeEl.removeChild( routeEl.firstChild )
        }
        //this forces a re-render on route change
        routeEl.append( ...children.map( c => renderNode( typeof c === 'function' ? c() : c ) ) )
        routeEl.style.display = display

    }
    return routeEl
}

/**
 * An element that only renders the first route that matches and updates when the route is changed
 * The primary purpose of this element is to provide catchall routes for not found pages and path variables
 * @param children
 */
export const routeSwitch = ( ...children ) => {
    const sw = h( 'div', getAttrs( children ) )

    return pathState.bindAs(
        () => {
            while( sw.firstChild ) {
                sw.removeChild( sw.firstChild )
            }
            for( let child of children ) {
                const path = child.getAttribute( 'path' )
                if( path ) {
                    const shouldDisplay = shouldDisplayRoute( path, !!child.absolute || child.getAttribute( 'absolute' ) === 'true' )
                    if( shouldDisplay ) {
                        //Set the actual current path parameters
                        pathParameters( extractPathParameters( path ) )
                        child.updateRoute( true )
                        sw.append( child )
                        return sw
                    }
                }
            }
        }
    )
}

function extractPathParameters( path ) {
    let pathParts = path.split( '/' )
    let currentParts = pathState().currentRoute.split( '/' )
    let parameters = {}
    for( let i = 0; i < pathParts.length; i++ ) {
        if( pathParts[ i ].startsWith( '$' ) ) {
            parameters[ pathParts[ i ].substr( 1 ) ] = currentParts[ i ]
        }
    }
    return parameters
}

/**
 * A link component that is a link to another route in this single page app
 * @param children The attributes of the anchor element and any children
 */
export const fnlink = ( ...children ) => {
    let context = null
    if( children[ 0 ] && children[ 0 ].context ) {
        context = children[ 0 ].context
    }
    let a = h( 'a', ...children )

    let to = a.getAttribute( 'to' )
    if( !to ) {
        throw new Error( 'fnlink must have a "to" string attribute' ).stack
    }
    a.addEventListener( 'click', ( e ) => {
        e.preventDefault()
        e.stopPropagation()
        goTo( to, context )
    } )
    a.setAttribute(
        'href',
        makePath( to )
    )
    return a
}

/**
 * A function to navigate to the specified route
 * @param route The route to navigate to
 * @param context Data related to the route change
 * @param replace Whether to replace the state or push it. pushState is used by default.
 * @param silent Prevent route change events from being emitted for this route change
 */
export const goTo = ( route, context, replace = false, silent = false ) => {
    let newPath = window.location.origin + makePath( route )

    const patch = {
        currentRoute: route.split( /[#?]/ )[ 0 ],
        context
    }

    const oldPathState = pathState()
    const newPathState = Object.assign( {}, oldPathState, patch )
    if( !silent ) {
        try {
            emit( beforeRouteChange, newPathState, oldPathState )
        } catch(e) {
            console.log( 'Path change cancelled', e )
            return
        }
    }
    if( replace ) {
        history.replaceState( {}, route, newPath )
    } else {
        history.pushState( {}, route, newPath )
    }

    setTimeout( () => {
        pathState.assign( {
                             currentRoute: route.split( /[#?]/ )[ 0 ],
                             context
                         } )
        if( !silent ) {
            emit( afterRouteChange, newPathState, oldPathState )
        }
        if( newPath.indexOf( '#' ) > -1 ) {
            const el = document.getElementById( decodeURIComponent( newPath.split( '#' )[ 1 ] ) )
            el && el.scrollIntoView()
        } else {
            window.scrollTo( 0, 0 )
        }
        if( !silent ) {
            emit( routeChangeComplete, newPathState, oldPathState )
        }
    } )

}

const ensureOnlyLeadingSlash = ( part ) => {
    part = part.startsWith( '/' ) ? part : '/' + part
    return part.endsWith( '/' ) && part.length > 1 ? part.slice( 0, -1 ) : part
}

export const pathParameters = fnstate( {} )

export const pathState = fnstate(
    {
        rootPath: ensureOnlyLeadingSlash( window.location.pathname ),
        currentRoute: ensureOnlyLeadingSlash( window.location.pathname ),
        context: null
    } )

export const beforeRouteChange = 'beforeRouteChange'
export const afterRouteChange = 'afterRouteChange'
export const routeChangeComplete = 'routeChangeComplete'
const eventListeners = {
    [ beforeRouteChange ]: [],
    [ afterRouteChange ]: [],
    [ routeChangeComplete ]: []
}

const emit = ( event, newPathState, oldPathState ) => {
    eventListeners[ event ].forEach( fn => fn( newPathState, oldPathState ) )
}

/**
 * Listen for routing events
 * @param event a string event to listen for
 * @param handler A function that will be called when the event occurs.
 *                  The function receives the new and old pathState objects, in that order.
 * @return {function()} a function to stop listening with the passed handler.
 */
export const listenFor = ( event, handler ) => {
    if( !eventListeners[ event ] ) {
        throw `Invalid event. Must be one of ${Object.keys( eventListeners )}`
    }
    eventListeners[ event ].push( handler )
    return () => {
        let i = eventListeners[ event ].indexOf( handler )
        return eventListeners[ event ].splice( i, 1 )
    }
}

/**
 * Set the root path of the app. This is necessary to make deep linking work in cases where the same html file is served from all paths.
 */
export const setRootPath = ( rootPath ) =>
    pathState.assign( {
                         rootPath: ensureOnlyLeadingSlash( rootPath ),
                         currentRoute: ensureOnlyLeadingSlash( window.location.pathname.replace( new RegExp( '^' + rootPath ), '' ) ) || '/'
                     } )


window.addEventListener(
    'popstate',
    () => {
        const oldPathState = pathState()
        const patch = {
            currentRoute: ensureOnlyLeadingSlash( window.location.pathname.replace( new RegExp( '^' + pathState().rootPath ), '' ) ) || '/'
        }
        const newPathState = Object.assign( {}, oldPathState, patch )
        try {
            emit( beforeRouteChange, newPathState, oldPathState )
        } catch(e) {
            console.trace( 'Path change cancelled', e )
            goTo( oldPathState.currentRoute, oldPathState.context, true, true )
            return
        }
        pathState.assign( patch )
        emit( afterRouteChange, newPathState, oldPathState )
        emit( routeChangeComplete, newPathState, oldPathState )
    }
)

const makePath = path => ( pathState().rootPath === '/' ? '' : pathState().rootPath ) + ensureOnlyLeadingSlash( path )

const shouldDisplayRoute = ( route, isAbsolute ) => {
    let path = makePath( route )
    const currPath = window.location.pathname
    if( isAbsolute ) {
        return currPath === path || currPath === ( path + '/' ) || currPath.match( ( path ).replace( /\/\$[^/]+(\/?)/g, '/[^/]+$1' ) + '$' )
    } else {
        const pattern = path.replace( /\/\$[^/]+(\/|$)/, '/[^/]+$1' ).replace( /^(.*)\/([^\/]*)$/, '$1/?$2([/?#]|$)' )
        return !!currPath.match( pattern )
    }
}