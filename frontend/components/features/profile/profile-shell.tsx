import styles from './profile.module.css'

interface ProfileShellProps {
  children: React.ReactNode
}

export function ProfileShell({ children }: ProfileShellProps) {
  return (
    <div className={styles.page}><div className={styles.shell}>{children}</div></div>
  )
}
