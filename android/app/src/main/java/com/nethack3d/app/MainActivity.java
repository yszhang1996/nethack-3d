import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Tell Android we are drawing edge-to-edge
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        
        WindowInsetsControllerCompat windowInsetsController = 
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());

        // Hide both the status bar and the bottom navigation bar
        windowInsetsController.hide(WindowInsetsCompat.Type.systemBars());
        
        // Allow the bars to temporarily appear if the user swipes from the edge
        windowInsetsController.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}