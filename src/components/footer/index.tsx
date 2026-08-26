import styles from './footer.module.css'
import { RiMusic2Fill } from 'react-icons/ri'
import Marquee from 'react-fast-marquee'
import { FC, JSX } from 'react'
import type { LocalVideo } from '../../types/video'

export interface IFooterProps {
    video: LocalVideo
}

const Footer: FC<IFooterProps> = ({ video }): JSX.Element => {
    return (
        <div className={styles.videoFooter}>
            <div className={styles.videoFooter__text}>
                <h3>
                    <span>@</span>local
                </h3>
                <p>{video.title}</p>

                <div className={styles.videoFooter__marquee}>
                    <RiMusic2Fill size={16} color={'#e9e9e9'} />
                    <Marquee
                        gradient={false}
                        pauseOnHover={true}
                        speed={40}
                        style={{ maxWidth: '40%', marginLeft: '10px' }}
                    >
                        <p>{video.fileName}</p>
                    </Marquee>
                </div>
            </div>
        </div>
    )
}

export default Footer
