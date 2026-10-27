import React, { useEffect, useRef } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { fetchPrefs } from 'store/modules/prefs'
import FirstRun from './FirstRun/FirstRun'
import SignedInView from './SignedInView/SignedInView'
import SignedOutView from './SignedOutView/SignedOutView'
import styles from './AccountView.css'
import { Navigate, useLocation } from 'react-router'
import { legacyAdminPaths } from 'components/Admin/legacyAdminPaths'

const AccountView = () => {
  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const location = useLocation()
  const isSignedIn = useAppSelector(state => state.user.userId !== null)
  const isFirstRun = useAppSelector(state => state.prefs.isFirstRun === true)
  const ui = useAppSelector(state => state.ui)
  const dispatch = useAppDispatch()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // once per mount
  // (do this here instead of Prefs component to detect firstRun)
  useEffect(() => {
    dispatch(fetchPrefs())
  }, [dispatch])

  if (isAdmin && !isFirstRun) {
    const requested = new URLSearchParams(location.search).get('redirect')
    const redirect = requested && /^\/(?:admin(?:\/[^?#]*)?|library|queue|requests|player)(?:[?#]|$)/.test(requested) ? requested : '/admin/account'
    return <Navigate to={legacyAdminPaths[location.hash] || redirect} replace />
  }

  return (
    <div
      ref={scrollContainerRef}
      className={styles.container}
      style={{
        paddingTop: ui.headerHeight,
        paddingBottom: ui.footerHeight + 28,
        scrollPaddingTop: ui.headerHeight + 12,
      }}
    >
      {isSignedIn
        && <SignedInView scrollContainerRef={scrollContainerRef} />}

      {!isFirstRun && !isSignedIn
        && <SignedOutView />}

      {isFirstRun
        && <FirstRun />}
    </div>
  )
}

export default AccountView
